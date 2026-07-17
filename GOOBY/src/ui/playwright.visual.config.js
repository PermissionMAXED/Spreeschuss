import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export default {
  testDir: ".",
  testMatch: "visual.spec.ts",
  fullyParallel: false,
  timeout: 120000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4521",
    browserName: "chromium",
  },
  webServer: {
    command: "npx vite build && npx vite preview --host 127.0.0.1 --port 4521",
    cwd: projectRoot,
    url: "http://127.0.0.1:4521",
    reuseExistingServer: false,
    timeout: 120000,
  },
};
