import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.GOOBY_PERF_PORT ?? "4520", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new RangeError("GOOBY_PERF_PORT must be a valid TCP port");
}

const baseUrl = `http://${host}:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", host, "--port", String(port), "--strictPort"],
  { stdio: "inherit", env: process.env },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Performance audit server exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The development server has not started listening yet.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function runAudit() {
  await waitForServer();
  const audit = spawn(
    process.execPath,
    ["scripts/audit/perf-browser.mjs"],
    {
      stdio: "inherit",
      env: { ...process.env, GOOBY_URL: baseUrl },
    },
  );
  const [code, signal] = await new Promise((resolve, reject) => {
    audit.once("error", reject);
    audit.once("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  if (code !== 0) {
    throw new Error(`Performance browser audit failed (${signal ?? `exit ${String(code)}`})`);
  }
}

try {
  await runAudit();
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
}
