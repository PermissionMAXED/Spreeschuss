export interface PerfServerIdentity {
  readonly service: "gooby-perf-vite";
  readonly protocol: 1;
  readonly nonce: string;
  readonly pid: number;
}

export const PERF_IDENTITY_SERVICE: PerfServerIdentity["service"];
export const PERF_IDENTITY_PROTOCOL: PerfServerIdentity["protocol"];

export class ServerIdentityError extends Error {}

export function identityPath(nonce: string): string;
export function identityUrl(baseUrl: string, nonce: string): string;
export function reserveFreePort(host?: string, requestedPort?: number): Promise<number>;
export function assertServerIdentity(
  payload: unknown,
  expectedNonce: string,
): PerfServerIdentity;
export function probeServerIdentity(
  baseUrl: string,
  nonce: string,
  fetchImpl?: typeof fetch,
): Promise<
  | { readonly ready: true; readonly identity: PerfServerIdentity }
  | { readonly ready: false; readonly error: unknown }
>;
export function waitForServerIdentity(options: {
  readonly baseUrl: string;
  readonly nonce: string;
  readonly isProcessAlive: () => boolean;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly fetchImpl?: typeof fetch;
}): Promise<PerfServerIdentity>;
