import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
