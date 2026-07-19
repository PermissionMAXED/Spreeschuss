import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.mjs",
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4554",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run dev -- --port 4554 --strictPort",
    url: "http://127.0.0.1:4554",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
