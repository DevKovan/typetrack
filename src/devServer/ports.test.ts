import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "bun:test";
import { findFreePort, HealthPollTimeoutError, waitForHealthy } from "./ports";

const HOSTNAME = "127.0.0.1";

function listenOn(port: number): Promise<import("node:net").Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, HOSTNAME, () => resolve(server));
  });
}

function closeServer(server: import("node:net").Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("findFreePort", () => {
  const openServers: Array<import("node:net").Server> = [];

  afterEach(async () => {
    await Promise.all(openServers.splice(0).map(closeServer));
  });

  it("returns the start port when it's free", async () => {
    const port = await findFreePort({ startPort: 4400, hostname: HOSTNAME });
    expect(port).toBe(4400);
  });

  it("skips an occupied port and returns the next free one", async () => {
    const held = await listenOn(4410);
    openServers.push(held);

    const port = await findFreePort({ startPort: 4410, hostname: HOSTNAME });
    expect(port).toBe(4411);
  });

  it("throws a clear error after exhausting max attempts", async () => {
    const startPort = 4420;
    const maxAttempts = 3;
    const held = await Promise.all(
      [startPort, startPort + 1, startPort + 2].map((port) => listenOn(port)),
    );
    openServers.push(...held);

    await expect(findFreePort({ startPort, maxAttempts, hostname: HOSTNAME })).rejects.toThrow(
      /No free port found/,
    );
  });
});

describe("waitForHealthy", () => {
  it("resolves once a server actually starts responding 200", async () => {
    // Only starts returning 200 after a short delay, proving `waitForHealthy`
    // actually polls rather than checking once.
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 150);

    const server = Bun.serve({
      port: 0,
      hostname: HOSTNAME,
      fetch: () => (ready ? new Response("ok", { status: 200 }) : new Response("not ready", { status: 503 })),
    });

    try {
      await waitForHealthy(`http://${HOSTNAME}:${server.port}/`, { timeoutMs: 2000, intervalMs: 20 });
      expect(ready).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("rejects with a timeout error against a URL nothing is listening on", async () => {
    const start = Date.now();
    const timeoutMs = 300;

    await expect(
      waitForHealthy(`http://${HOSTNAME}:1/`, { timeoutMs, intervalMs: 20 }),
    ).rejects.toBeInstanceOf(HealthPollTimeoutError);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(timeoutMs * 3);
  });
});
