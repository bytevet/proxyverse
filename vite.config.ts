/// <reference types="vitest" />

import path, { resolve } from "path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ArcoResolver } from "unplugin-vue-components/resolvers";
import { visualizer } from "rollup-plugin-visualizer";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { parseBuildEnv, syncDefines } from "./build/env.ts";
import { buildManifest, crxVersion, needsDevKey } from "./build/manifest.ts";

// Use createRequire instead of `import manifest from "./manifest.json"` to
// work around a Rolldown panic on nested member expressions of JSON imports.
const manifest = createRequire(import.meta.url)("./manifest.json");

const PROXYVERSE_ENV = parseBuildEnv(process.env.PROXYVERSE_ENV);
const CRX_VERSION = crxVersion(process.env.CRX_VER);

// the dev public key, read only by builds that need it (see build/README.md)
const readDevKey = () =>
  readFileSync(resolve(import.meta.dirname, "build/dev-extension-key.pub"), "utf8").trim();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const target = mode === "firefox" ? "firefox" : "chrome";

  return {
    define: syncDefines(PROXYVERSE_ENV),
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
        generateBundle(_outputOption, bundle) {
          const entry = Object.values(bundle).find(
            (chunk) =>
              chunk.type == "chunk" &&
              chunk.isEntry &&
              chunk.name == "background",
          );
          const built = buildManifest(manifest, {
            mode: target,
            env: PROXYVERSE_ENV,
            version: CRX_VERSION,
            serviceWorker: (entry as any).fileName,
            devKey: needsDevKey(target, PROXYVERSE_ENV) ? readDevKey() : undefined,
          });

          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(built, undefined, 2),
          });
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, "index.html"),
          popup: resolve(__dirname, "popup.html"),
          background: "src/background.ts",
        },
        output: {},
        plugins: [
          visualizer({
            filename: "stats.html",
            open: false,
          }),
        ],
      },
    },
  };
});
