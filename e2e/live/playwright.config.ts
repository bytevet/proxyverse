import { defineConfig } from "@playwright/test";

// The live sync smoke against northernlight.byte.vet, run by hand:
// `npm run test:e2e:live`. It needs a person to sign in, so it is never part
// of `npm run test:e2e` or CI.
export default defineConfig({
  testMatch: "**/*.live.ts",
  globalSetup: "./global-setup.ts",
  outputDir: "../../test-results/live",
  // signing in by hand, twice, takes a while
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
});
