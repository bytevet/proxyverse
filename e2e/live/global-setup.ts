import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

/** A Chrome build for northernlight, with the dev key's fixed extension ID. */
export default function globalSetup() {
  if (process.env.E2E_SKIP_BUILD) return;
  execSync(
    "npx vite build --outDir .e2e-build/live-chrome --emptyOutDir --logLevel warn",
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, PROXYVERSE_ENV: "northernlight" },
    }
  );
}
