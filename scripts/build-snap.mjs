import { spawnSync } from 'node:child_process'
import './prepare-snap.mjs'

// The GUI already contains its client credential. Do not pass an exported
// build key into Snapcraft's environment or its managed instance.
const env = { ...process.env }
delete env.K1VPN_CLIENT_IP_KEY
const result = spawnSync('snapcraft', ['pack', '--use-lxd'], { stdio: 'inherit', env })
if (result.error) throw result.error
process.exit(result.status ?? 1)
