import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  root: projectRoot,
  server: {
    hmr: false,
    watch: {
      ignored: ["**/*"],
    },
  },
});
