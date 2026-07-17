import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export const PERF_IDENTITY_SERVICE = "gooby-perf-vite";
export const PERF_IDENTITY_PROTOCOL = 1;

export class ServerIdentityError extends Error {
  constructor(message) {
    super(message);
    this.name = "ServerIdentityError";
  }
}

export function identityPath(nonce) {
  if (typeof nonce !== "string" || nonce.length < 8) {
    throw new TypeError("Performance audit nonce must contain at least eight characters");
  }
  return `/.well-known/gooby-perf/${encodeURIComponent(nonce)}`;
}

export function identityUrl(baseUrl, nonce) {
  return new URL(identityPath(nonce), baseUrl).href;
}

export async function reserveFreePort(host = "127.0.0.1", requestedPort = 0) {
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    throw new RangeError("Requested performance port must be 0 or a valid TCP port");
  }
  const reservation = createServer();
  reservation.unref();
  const port = await new Promise((resolve, reject) => {
    const cleanup = () => {
      reservation.off("error", onError);
      reservation.off("listening", onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reject(new Error("Performance port reservation returned no TCP address"));
        return;
      }
      resolve(address.port);
    };
    reservation.once("error", onError);
    reservation.once("listening", onListening);
    reservation.listen({ host, port: requestedPort, exclusive: true });
  });
  await new Promise((resolve, reject) => {
    reservation.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return port;
}

export function assertServerIdentity(payload, expectedNonce) {
  if (
    typeof payload !== "object"
    || payload === null
    || payload.service !== PERF_IDENTITY_SERVICE
    || payload.protocol !== PERF_IDENTITY_PROTOCOL
    || payload.nonce !== expectedNonce
    || !Number.isInteger(payload.pid)
    || payload.pid <= 0
  ) {
    throw new ServerIdentityError(
      `Performance server identity mismatch for nonce ${expectedNonce}`,
    );
  }
  return payload;
}

export async function probeServerIdentity(baseUrl, nonce, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(identityUrl(baseUrl, nonce), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    return { ready: false, error };
  }
  if (!response.ok) {
    throw new ServerIdentityError(
      `Performance server identity endpoint returned HTTP ${response.status}`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ServerIdentityError(
      `Performance server identity endpoint returned invalid JSON: ${String(error)}`,
    );
  }
  return { ready: true, identity: assertServerIdentity(payload, nonce) };
}

export async function waitForServerIdentity({
  baseUrl,
  nonce,
  isProcessAlive,
  timeoutMs = 30_000,
  pollMs = 100,
  fetchImpl = fetch,
}) {
  const deadline = performance.now() + timeoutMs;
  let lastConnectionError = null;
  while (performance.now() < deadline) {
    if (!isProcessAlive()) {
      throw new Error("Performance Vite process exited before readiness");
    }
    const probe = await probeServerIdentity(baseUrl, nonce, fetchImpl);
    if (probe.ready) return probe.identity;
    lastConnectionError = probe.error;
    await delay(pollMs);
  }
  throw new Error(
    `Timed out waiting for performance server identity at ${identityUrl(baseUrl, nonce)}`
      + (lastConnectionError ? `: ${String(lastConnectionError)}` : ""),
  );
}
