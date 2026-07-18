import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "three",
              test: /node_modules[\\/]three[\\/]/u,
              priority: 3,
            },
            {
              name: "zod",
              test: /node_modules[\\/]zod[\\/]/u,
              priority: 2,
            },
            {
              name: "capacitor",
              test: /node_modules[\\/]@capacitor[\\/]/u,
              priority: 1,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      // The extracted asset source cache holds tens of thousands of vendored
      // files; watching it exhausts inotify watchers and kills dev servers.
      ignored: ["**/.asset-cache/**"],
    },
  },
});
