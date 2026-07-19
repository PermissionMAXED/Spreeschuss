import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "city.e2e.ts",
  fullyParallel: false,
  timeout: 150_000,
  reporter: "list",
  outputDir: "/tmp/gooby-city-playwright",
  use: {
    ...devices["iPhone 13"],
    baseURL: "http://127.0.0.1:4547",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "on",
  },
  webServer: {
    cwd: projectRoot,
    command: "npx vite --config src/scenes/city/harness.vite.config.ts --host 0.0.0.0 --port 4547 --strictPort",
    url: "http://127.0.0.1:4547/src/scenes/city/dev-harness.html",
    reuseExistingServer: process.env.CITY_REUSE_EXISTING_SERVER === "1",
    timeout: 120_000,
  },
});
