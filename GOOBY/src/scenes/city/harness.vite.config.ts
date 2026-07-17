import { defineConfig } from "vite";

export default defineConfig({
  root: "/workspace/GOOBY",
  server: {
    hmr: false,
    watch: {
      ignored: ["**/*"],
    },
  },
});
