import { createServer, type Server as NetServer } from "node:net";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { readPortFile } from "./portFile";
import { startDevServer, type DevServerHandle } from "./server";

const REPO_ROOT = join(import.meta.dir, "..", "..");

let handle: DevServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
  rmSync(join(REPO_ROOT, ".typetrack"), { recursive: true, force: true });
});

describe("startDevServer, real HTTP round trip", () => {
  it("records a mix of valid/invalid/schema-less events, reflects setSchemas() changes, and frees the port on stop()", async () => {
    handle = await startDevServer({ startPort: 4900 });
    handle.setSchemas({ signup_completed: z.object({ plan: z.enum(["free", "pro"]) }) });

    await fetch(`${handle.url}/events`, {
      method: "POST",
      body: JSON.stringify({ event: "signup_completed", payload: { plan: "pro" } }),
    });
    await fetch(`${handle.url}/events`, {
      method: "POST",
      body: JSON.stringify({ event: "signup_completed", payload: { plan: "nope" } }),
    });
    await fetch(`${handle.url}/events`, {
      method: "POST",
      body: JSON.stringify({ event: "page_viewed", payload: { path: "/" } }),
    });

    const eventsResponse = await fetch(`${handle.url}/events`);
    const events = (await eventsResponse.json()) as Array<{ event: string; valid: boolean }>;

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ event: "signup_completed", valid: true });
    expect(events[1]).toMatchObject({ event: "signup_completed", valid: false });
    expect(events[2]).toMatchObject({ event: "page_viewed", valid: true });

    handle.setSchemas({ page_viewed: z.object({ path: z.string() }) });
    const schemaResponse = await fetch(`${handle.url}/schema`);
    const schemaBody = (await schemaResponse.json()) as { events: Record<string, unknown> };
    expect(Object.keys(schemaBody.events)).toEqual(["page_viewed"]);

    const reclaimedPort = handle.port;
    await handle.stop();
    handle = undefined;

    // A fresh bind attempt on the exact same port must succeed immediately.
    const rebound: NetServer = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(reclaimedPort, "127.0.0.1", () => resolve(server));
    });
    await new Promise<void>((resolve) => rebound.close(() => resolve()));
  });

  it("writes .typetrack/port on disk after resolving, containing the handle's actual port", async () => {
    handle = await startDevServer({ startPort: 4910 });

    const portOnDisk = await readPortFile(REPO_ROOT);
    expect(portOnDisk).toBe(handle.port);
  });

  it("prints a diff containing the offending field's path and message on a failed-validation POST", async () => {
    handle = await startDevServer({ startPort: 4920 });
    handle.setSchemas({ signup_completed: z.object({ plan: z.enum(["free", "pro"]) }) });

    const originalLog = console.log;
    const lines: unknown[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.join(" "));
    };

    try {
      await fetch(`${handle.url}/events`, {
        method: "POST",
        body: JSON.stringify({ event: "signup_completed", payload: { plan: "enterprise" } }),
      });
    } finally {
      console.log = originalLog;
    }

    expect(lines).toHaveLength(1);
    const printed = String(lines[0]);
    expect(printed).toContain("plan");
    expect(printed).not.toContain("[object Object]");
    expect(printed).not.toContain('"code"');
  });

  it("GET / serves the event inspector HTML page", async () => {
    handle = await startDevServer({ startPort: 4940 });

    const response = await fetch(`${handle.url}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/html");

    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("<!doctype html>");
  });

  it("prints exactly one line on a successful POST", async () => {
    handle = await startDevServer({ startPort: 4930 });

    const originalLog = console.log;
    const lines: unknown[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.join(" "));
    };

    try {
      await fetch(`${handle.url}/events`, {
        method: "POST",
        body: JSON.stringify({ event: "page_viewed", payload: { path: "/" } }),
      });
    } finally {
      console.log = originalLog;
    }

    expect(lines).toHaveLength(1);
  });
});
