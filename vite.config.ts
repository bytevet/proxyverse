import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { vitePluginForArco } from '@arco-plugins/vite-vue'
import manifest from './manifest.json'

let sourcemap = false
if (process.env.npm_lifecycle_event?.endsWith(':test')) {
  sourcemap = true
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vitePluginForArco({
      style: 'css',
    }),
    {
      name: 'manifest',
      generateBundle(outputOption, bundle) {
        const entry = Object.values(bundle).find(
          (chunk) => chunk.type == 'chunk' && chunk.isEntry && chunk.name == 'background');
        manifest.version = process.env.npm_package_version || '0.0.0'
        manifest.background.service_worker = (entry as any).fileName

        this.emitFile({
          type: "asset",
          fileName: 'manifest.json',
          source: JSON.stringify(manifest, undefined, 2)
        })
      }
    }
  ],

  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        popup: resolve(__dirname, 'popup.html'),
        background: 'src/background.ts',
      },
    },
    sourcemap
  }
})
