import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  reserveFreePort,
  waitForServerIdentity,
} from "../../src/perf/audit-runner.mjs";

const host = "127.0.0.1";
const requestedPort = process.env.GOOBY_PERF_PORT === undefined
  ? 0
  : Number.parseInt(process.env.GOOBY_PERF_PORT, 10);
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
  throw new RangeError("GOOBY_PERF_PORT must be a valid TCP port when provided");
}

function childExit(child, label) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ label, code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ label, code, signal }));
  });
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = childExit(child, "cleanup");
  child.kill("SIGTERM");
  const result = await Promise.race([
    exited.then(() => "exited"),
    delay(5_000).then(() => "timeout"),
  ]);
  if (result === "timeout" && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

const port = await reserveFreePort(host, requestedPort);
const nonce = randomUUID();
const baseUrl = `http://${host}:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    "src/perf/vite-audit.config.mjs",
    "--host",
    host,
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, GOOBY_PERF_NONCE: nonce },
  },
);
const serverExit = childExit(server, "server");
let audit = null;

console.log(`Performance audit Vite: ${baseUrl} (nonce ${nonce})`);
try {
  const identity = await Promise.race([
    waitForServerIdentity({
      baseUrl,
      nonce,
      isProcessAlive: () => server.exitCode === null && server.signalCode === null,
      timeoutMs: 30_000,
    }),
    serverExit.then(({ code, signal }) => {
      throw new Error(
        `Performance Vite exited before readiness (${signal ?? `exit ${String(code)}`})`,
      );
    }),
  ]);
  if (server.exitCode !== null || server.signalCode !== null) {
    throw new Error("Performance Vite exited immediately after readiness");
  }

  audit = spawn(
    process.execPath,
    ["scripts/audit/perf-browser.mjs"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        GOOBY_URL: baseUrl,
        GOOBY_PERF_NONCE: nonce,
        GOOBY_PERF_SERVER_PID: String(identity.pid),
      },
    },
  );
  const auditExit = childExit(audit, "browser");
  let auditTimeout;
  const timeout = new Promise((resolve) => {
    auditTimeout = setTimeout(
      () => resolve({ label: "timeout", code: null, signal: null }),
      240_000,
    );
    auditTimeout.unref();
  });
  const outcome = await Promise.race([
    auditExit,
    serverExit,
    timeout,
  ]);
  clearTimeout(auditTimeout);
  if (outcome.label === "timeout") {
    throw new Error("Performance browser audit timed out after 240 seconds");
  }
  if (outcome.label === "server") {
    throw new Error(
      `Performance Vite exited during browser audit (${outcome.signal ?? `exit ${String(outcome.code)}`})`,
    );
  }
  if (outcome.code !== 0) {
    throw new Error(
      `Performance browser audit failed (${outcome.signal ?? `exit ${String(outcome.code)}`})`,
    );
  }
  if (server.exitCode !== null || server.signalCode !== null) {
    throw new Error("Performance Vite exited before the browser audit completed");
  }
} finally {
  await terminate(audit);
  await terminate(server);
}
