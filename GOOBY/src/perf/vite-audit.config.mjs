import { defineConfig } from "vite";
import {
  PERF_IDENTITY_PROTOCOL,
  PERF_IDENTITY_SERVICE,
  identityPath,
} from "./audit-runner.mjs";

const nonce = process.env.GOOBY_PERF_NONCE;
if (!nonce) throw new Error("GOOBY_PERF_NONCE is required by the performance Vite config");
const endpoint = identityPath(nonce);

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    strictPort: true,
    watch: {
      // The extracted asset source cache holds tens of thousands of vendored
      // files; watching it exhausts inotify watchers and kills the audit server.
      ignored: ["**/.asset-cache/**"],
    },
  },
  plugins: [
    {
      name: "gooby-perf-run-identity",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
          if (pathname !== endpoint) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader("cache-control", "no-store");
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify({
            service: PERF_IDENTITY_SERVICE,
            protocol: PERF_IDENTITY_PROTOCOL,
            nonce,
            pid: process.pid,
          }));
        });
      },
    },
  ],
});
