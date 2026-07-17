import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "visual.spec.ts",
  fullyParallel: false,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4519",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4519",
    url: "http://127.0.0.1:4519",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
