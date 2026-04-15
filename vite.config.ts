/// <reference types="vitest" />

import path, { resolve } from "path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ArcoResolver } from "unplugin-vue-components/resolvers";
import { visualizer } from "rollup-plugin-visualizer";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { createRequire } from "module";

// Use createRequire instead of `import manifest from "./manifest.json"` to
// work around a Rolldown panic on nested member expressions of JSON imports.
const manifest = createRequire(import.meta.url)("./manifest.json");

const env = process.env;

const getCRXVersion = () => {
  const crxVer = env.CRX_VER;
  if (crxVer) {
    let ver = crxVer;
    if (ver.startsWith("v")) {
      ver = ver.slice(1);
    }
    return ver.slice(0, 14);
  }
  return "0.0.0-dev";
};

// Workaround: Rolldown (Vite 8) panics on nested member expressions like
// `manifest.background.service_worker` during config transformation.
// Hoist `manifest.background` into a local variable to flatten the access.
const manifestBg = manifest.background;

function transformManifestForFirefox() {
  manifestBg.scripts = [manifestBg.service_worker];
  delete manifestBg.service_worker;

  delete (manifest as any).version_name;

  (manifest as any).browser_specific_settings = {
    gecko: {
      id: "proxyverse@byte.vet",
      strict_min_version: "109.0",
    },
  };
}

type Transformer = {
  manifest(): void;
};

const TRANSFORMER_CONFIG: Record<string, Transformer> = {
  firefox: {
    manifest: transformManifestForFirefox,
  },
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isTest = mode === "test";
  const transformer = TRANSFORMER_CONFIG[mode];

  return {
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
          manifest.version = getCRXVersion().split("-", 1)[0];
          manifest.version_name = getCRXVersion();
          // avoid cache issues
          manifestBg.service_worker = (entry as any).fileName;

          transformer?.manifest();

          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(manifest, undefined, 2),
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
          isTest
            ? undefined
            : sentryVitePlugin({
                authToken: env.SENTRY_AUTH_TOKEN,
                org: "bytevet",
                project: "proxyverse",
                telemetry: false,
                sourcemaps: {
                  filesToDeleteAfterUpload: "**/*.js.map",
                },
                bundleSizeOptimizations: {
                  excludeDebugStatements: true,
                },
                release: {
                  inject: true,
                  dist: `v${getCRXVersion()}-${mode ? mode : "crx"}`,
                },
              }),
          isTest
            ? undefined
            : visualizer({
                filename: "stats.html",
                open: true,
              }),
        ],
      },
    },
  };
});
