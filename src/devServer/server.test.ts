import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { startDevServer, type DevServerHandle } from "./server";

let handle: DevServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

async function post(base: string, body: unknown, rawBody?: string): Promise<Response> {
  return fetch(`${base}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
}

describe("startDevServer route behavior", () => {
  it("accepts a valid event and reports valid: true", async () => {
    handle = await startDevServer({ startPort: 4700 });
    handle.setSchemas({ signup_completed: z.object({ plan: z.enum(["free", "pro"]) }) });

    const response = await post(handle.url, { event: "signup_completed", payload: { plan: "pro" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, valid: true });
  });

  it("accepts a schema-mismatched event, reports valid: false, and still records it", async () => {
    handle = await startDevServer({ startPort: 4710 });
    handle.setSchemas({ signup_completed: z.object({ plan: z.enum(["free", "pro"]) }) });

    const response = await post(handle.url, { event: "signup_completed", payload: { plan: "enterprise" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, valid: false });

    const events = handle.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.valid).toBe(false);
    expect(events[0]?.issues?.length).toBeGreaterThan(0);
  });

  it("rejects malformed JSON with 400 and records nothing", async () => {
    handle = await startDevServer({ startPort: 4720 });

    const response = await post(handle.url, undefined, "{ not valid json");
    expect(response.status).toBe(400);
    expect(handle.getEvents()).toHaveLength(0);
  });

  it("rejects a body missing a string `event` field with 400", async () => {
    handle = await startDevServer({ startPort: 4730 });

    const response = await post(handle.url, { payload: { foo: "bar" } });
    expect(response.status).toBe(400);
    expect(handle.getEvents()).toHaveLength(0);
  });

  it("treats an event with no schema entry as passthrough valid: true", async () => {
    handle = await startDevServer({ startPort: 4740 });
    handle.setSchemas({ signup_completed: z.object({ plan: z.enum(["free", "pro"]) }) });

    const response = await post(handle.url, { event: "page_viewed", payload: { path: "/" } });
    expect(await response.json()).toEqual({ accepted: true, valid: true });
  });

  it("GET /schema reflects the currently-loaded schemas and updates after setSchemas()", async () => {
    handle = await startDevServer({ startPort: 4750 });

    const empty = await (await fetch(`${handle.url}/schema`)).json();
    expect(empty).toEqual({ events: {} });

    handle.setSchemas({ signup_completed: z.object({ plan: z.enum(["free", "pro"]) }) });

    const loaded = (await (await fetch(`${handle.url}/schema`)).json()) as { events: Record<string, unknown> };
    expect(Object.keys(loaded.events)).toEqual(["signup_completed"]);
  });

  it("GET /health is always 200 regardless of schema state", async () => {
    handle = await startDevServer({ startPort: 4760 });

    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
    expect(await (await fetch(`${handle.url}/health`)).json()).toEqual({ ok: true });

    handle.setSchemas({ signup_completed: z.object({ plan: z.enum(["free", "pro"]) }) });
    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
  });
});

describe("startDevServer ring buffer", () => {
  it("evicts the oldest event once bufferSize is exceeded, keeping the last N oldest-first", async () => {
    handle = await startDevServer({ startPort: 4770, bufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      await post(handle.url, { event: "tick", payload: { i } });
    }

    const events = handle.getEvents();
    expect(events).toHaveLength(3);
    expect(events.map((event) => (event.payload as { i: number }).i)).toEqual([2, 3, 4]);

    const response = await fetch(`${handle.url}/events`);
    const body = (await response.json()) as Array<{ payload: { i: number } }>;
    expect(body.map((event) => event.payload.i)).toEqual([2, 3, 4]);
  });
});

describe("startDevServer subscribe", () => {
  it("notifies subscribers once per received event and supports unsubscribe", async () => {
    handle = await startDevServer({ startPort: 4780 });

    const received: string[] = [];
    const unsubscribe = handle.subscribe((event) => received.push(event.event));

    await post(handle.url, { event: "first" });
    unsubscribe();
    await post(handle.url, { event: "second" });

    expect(received).toEqual(["first"]);
  });
});
