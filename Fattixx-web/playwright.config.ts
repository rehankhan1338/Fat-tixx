import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the dev server (started automatically if not running).
 * Uses the locally installed Chrome, so no browser download is needed.
 *   npm run test:e2e
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
/** The admin console (Fattixx-admin/) runs as a second server; platform staff sign in there. */
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/e2e/.report" }]],
  outputDir: "tests/e2e/.artifacts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1400, height: 950 },
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: [
    {
      command: "npm run dev",
      url: `${BASE_URL}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run admin:dev",
      url: `${ADMIN_URL}/`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
});
