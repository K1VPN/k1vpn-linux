import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  version: string
}

export default defineConfig(({ mode }) => ({
  main: {
    build: { minify: true },
    define: {
      __K1VPN_CLIENT_IP_KEY__: JSON.stringify(
        loadEnv(mode, resolve('.'), 'K1VPN_CLIENT_IP_KEY').K1VPN_CLIENT_IP_KEY ?? ''
      )
    }
  },
  preload: {
    // A sandboxed preload cannot be an ES module, so it is emitted as
    // CommonJS with an explicit extension despite "type": "module".
    build: {
      minify: true,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    // Less script to parse before the first window paints.
    build: { minify: true },
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
}))
