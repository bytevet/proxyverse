import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const run = (cmd: string) => execSync(cmd, { cwd: root, stdio: "inherit" });

/**
 * Build the extension before the suite runs: for both browsers, or only the
 * one in `E2E_TARGET` ("chrome" | "firefox").
 */
export default function globalSetup() {
  if (process.env.E2E_SKIP_BUILD) return;
  const target = process.env.E2E_TARGET;

  if (target !== "firefox") {
    run("npx vite build --outDir .e2e-build/chrome --emptyOutDir --logLevel warn");
  }
  if (target !== "chrome") {
    run(
      "npx vite build -m firefox --outDir .e2e-build/firefox --emptyOutDir --logLevel warn"
    );
    run(
      "npx web-ext build -s .e2e-build/firefox -a .e2e-build -n proxyverse.xpi --overwrite-dest"
    );
  }
}
