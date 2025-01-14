/// <reference types="vitest" />

import path, { resolve } from "path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ArcoResolver } from "unplugin-vue-components/resolvers";
import manifest from "./manifest.json";

let sourcemap = false;
if (process.env.npm_lifecycle_event?.endsWith(":test")) {
  sourcemap = true;
}

const getCRXVersion = () => {
  if (process.env.CRX_VER) {
    let ver = process.env.CRX_VER;
    if (ver.startsWith("v")) {
      ver = ver.slice(1);
    }
    return ver.slice(0, 14);
  }
  return "0.0.0-dev";
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ArcoResolver()],
    }),
    Components({
      resolvers: [
        ArcoResolver({
          sideEffect: true,
        }),
      ],
    }),
    {
      name: "manifest",
      generateBundle(outputOption, bundle) {
        const entry = Object.values(bundle).find(
          (chunk) =>
            chunk.type == "chunk" && chunk.isEntry && chunk.name == "background"
        );
        manifest.version = getCRXVersion().split("-", 1)[0];
        manifest.version_name = getCRXVersion();
        manifest.background.service_worker = (entry as any).fileName;

        // To support firefox
        // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background#browser_support
        manifest.background.scripts = [(entry as any).fileName];

        this.emitFile({
          type: "asset",
          fileName: "manifest.json",
          source: JSON.stringify(manifest, undefined, 2),
        });
      },
    },
  ],
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        popup: resolve(__dirname, "popup.html"),
        background: "src/background.ts",
      },
      output: {
        manualChunks: {
          framework: [
            "vue",
            "vue-router",
            "@arco-design/web-vue",
            "@vueuse/core",
          ],
        },
      },
    },
    sourcemap,
  },
});
