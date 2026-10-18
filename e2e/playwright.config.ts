import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testMatch: "**/*.e2e.ts",
  globalSetup: "./global-setup.ts",
  outputDir: "../test-results",
  timeout: 45_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // each worker runs its own browser and test servers
  workers: CI ? 2 : 4,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI
    ? [["github"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]],
  projects: [
    { name: "chromium", testDir: "./specs" },
    { name: "firefox-smoke", testDir: "./firefox", fullyParallel: false },
  ],
});
