// Run with Electron, using an isolated profile, twice: write then read.
// Uses dummy data only; never reads the application's credentials or contacts its API.
const { app, safeStorage } = require('electron')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { resolve, join } = require('node:path')
const [phase, directory] = process.argv.slice(2)
if (!['write', 'read'].includes(phase) || !directory) throw new Error('Usage: electron check-secret-portal.cjs write|read PROFILE_DIRECTORY')
const profile = resolve(directory)
mkdirSync(profile, { recursive: true, mode: 0o700 })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.setDesktopName(process.env.SNAP_NAME === 'k1vpn' ? 'k1vpn_k1vpn.desktop' : 'k1vpn.desktop')
app.commandLine.appendSwitch('enable-features', 'DbusSecretPortal,SecretPortalKeyProviderUseForEncryption')
const timeout = setTimeout(() => { console.error('FAIL: secret provider timed out'); app.exit(1) }, 45000)
app.whenReady().then(async () => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Encryption unavailable')
  const file = join(profile, 'portal-probe.dat')
  if (phase === 'write') {
    const encrypted = await safeStorage.encryptStringAsync('K1VPN portal persistence test')
    if (encrypted.subarray(0, 3).toString() !== 'v12') throw new Error('Secret portal was not selected')
    writeFileSync(file, encrypted, { mode: 0o600 })
  } else {
    const result = await safeStorage.decryptStringAsync(readFileSync(file))
    if (result.result !== 'K1VPN portal persistence test') throw new Error('Persistence check failed')
  }
  console.log(`PASS: Secret portal ${phase}`)
  clearTimeout(timeout)
  app.quit()
}).catch(() => { console.error('FAIL: Secret portal unavailable or persistence check failed'); app.exit(1) })
