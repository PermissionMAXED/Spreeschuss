import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "browser.spec.mjs",
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4519",
  },
  webServer: {
    command: "npm run dev -- --port 4519",
    url: "http://127.0.0.1:4519",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
