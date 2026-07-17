import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  PERF_IDENTITY_PROTOCOL,
  PERF_IDENTITY_SERVICE,
  ServerIdentityError,
  reserveFreePort,
  waitForServerIdentity,
} from "./audit-runner.mjs";

const openServers: Server[] = [];

async function listen(server: Server): Promise<number> {
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no TCP address");
  return address.port;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    })));
});

describe("performance audit runner isolation", () => {
  it("rejects a requested port already owned by another process", async () => {
    const port = await listen(createTcpServer());
    await expect(reserveFreePort("127.0.0.1", port)).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
  });

  it("fails immediately when the readiness endpoint has another run identity", async () => {
    const expectedNonce = "expected-run-nonce";
    const server = createHttpServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        service: PERF_IDENTITY_SERVICE,
        protocol: PERF_IDENTITY_PROTOCOL,
        nonce: "different-run-nonce",
        pid: process.pid,
      }));
    });
    const port = await listen(server);

    await expect(waitForServerIdentity({
      baseUrl: `http://127.0.0.1:${port}`,
      nonce: expectedNonce,
      isProcessAlive: () => true,
      timeoutMs: 2_000,
      pollMs: 5,
    })).rejects.toBeInstanceOf(ServerIdentityError);
  });

  it("accepts only the matching nonce, protocol, service, and process identity", async () => {
    const nonce = "matching-run-nonce";
    const server = createHttpServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        service: PERF_IDENTITY_SERVICE,
        protocol: PERF_IDENTITY_PROTOCOL,
        nonce,
        pid: process.pid,
      }));
    });
    const port = await listen(server);

    await expect(waitForServerIdentity({
      baseUrl: `http://127.0.0.1:${port}`,
      nonce,
      isProcessAlive: () => true,
      timeoutMs: 2_000,
      pollMs: 5,
    })).resolves.toMatchObject({ nonce, pid: process.pid });
  });
});
