import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 180_000,
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
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
      },
    },
    {
      name: "ipad-820x1180",
      use: {
        ...devices["iPad Pro 11"],
        browserName: "chromium",
        viewport: { width: 820, height: 1180 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 4519",
    url: "http://127.0.0.1:4519",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
