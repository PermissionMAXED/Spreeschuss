import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.mjs",
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:4531",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run dev -- --port 4531 --strictPort",
    url: "http://127.0.0.1:4531",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
