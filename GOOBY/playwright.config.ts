import { defineConfig, devices } from "@playwright/test";

export const ROOT_E2E_TIMEOUT_MS = 180_000;
export const ROOT_E2E_CITY_TIMEOUT_MARGIN_MS = 30_000;
export const ROOT_E2E_CI_WORKERS = 1;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: true,
  ...(process.env.CI ? { workers: ROOT_E2E_CI_WORKERS } : {}),
  timeout: ROOT_E2E_TIMEOUT_MS,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:4519",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "phone-390x844",
      testMatch: [
        "**/app.spec.ts",
        "**/coverage.spec.ts",
        "**/shops.spec.ts",
      ],
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
      },
    },
    {
      name: "ipad-820x1180",
      testMatch: "**/ipad.spec.ts",
      use: {
        ...devices["iPad Pro 11"],
        browserName: "chromium",
        viewport: { width: 820, height: 1180 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 4519 --strictPort",
    url: "http://127.0.0.1:4519",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
