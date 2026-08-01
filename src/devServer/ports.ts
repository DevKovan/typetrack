import { createServer } from "node:net";

export interface FindFreePortOptions {
  startPort?: number;
  maxAttempts?: number;
  hostname?: string;
}

// Probe-bind-then-release: binds a throwaway listener to each candidate port
// in turn and releases it immediately, returning the first free one found.
// This has an inherent small TOCTOU race between releasing the probe socket
// here and the real server binding it later -- closing that race fully is
// out of scope here; the caller (002) is responsible for its own
// retry-on-bind-failure loop around the real `Bun.serve()` call.
export async function findFreePort(options: FindFreePortOptions = {}): Promise<number> {
  const { startPort = 4318, maxAttempts = 20, hostname = "127.0.0.1" } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = startPort + attempt;
    if (await isPortFree(candidate, hostname)) {
      return candidate;
    }
  }

  throw new Error(
    `No free port found in range ${startPort}-${startPort + maxAttempts - 1} on ${hostname} after ${maxAttempts} attempts`,
  );
}

function isPortFree(port: number, hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, hostname, () => {
      server.close(() => resolve(true));
    });
  });
}

export class HealthPollTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for ${url} to respond healthy`);
    this.name = "HealthPollTimeoutError";
  }
}

export interface WaitForHealthyOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

// Polls `url` until it responds with a 2xx status, used post-bind to confirm
// a real server is actually serving before considering a port "claimed".
// Connection-refused (and any other fetch failure) is swallowed and treated
// as "not ready yet" while under the deadline; only a deadline overrun
// surfaces as an error, and always as `HealthPollTimeoutError` -- so callers
// can never mistake a still-refusing connection for a genuine timeout.
export async function waitForHealthy(url: string, options: WaitForHealthyOptions = {}): Promise<void> {
  const { timeoutMs = 2000, intervalMs = 50 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet, or connection refused -- keep polling.
    }
    await sleep(Math.min(intervalMs, Math.max(deadline - Date.now(), 0)));
  }

  throw new HealthPollTimeoutError(url, timeoutMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
