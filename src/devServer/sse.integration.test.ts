import { afterEach, describe, expect, it } from "bun:test";
import { startDevServer, type DevServerEvent, type DevServerHandle } from "./server";

let handle: DevServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

async function post(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Reads exactly `count` `data: ...\n\n` SSE frames from a stream response
// body, ignoring any interleaved `:ping\n\n` keepalive comment frames.
async function readSseEvents(body: ReadableStream<Uint8Array>, count: number): Promise<DevServerEvent[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const events: DevServerEvent[] = [];

  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffered.indexOf("\n\n")) !== -1) {
      const frame = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      if (frame.startsWith("data: ")) {
        events.push(JSON.parse(frame.slice("data: ".length)) as DevServerEvent);
      }
    }
  }

  await reader.cancel();
  return events;
}

describe("GET /events/stream", () => {
  it("returns a text/event-stream response", async () => {
    handle = await startDevServer({ startPort: 4960 });

    const response = await fetch(`${handle.url}/events/stream`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await response.body?.cancel();
  });

  it("streams events posted after connecting live, in order, with matching payloads (no history replay)", async () => {
    handle = await startDevServer({ startPort: 4970 });

    // Posted before the SSE client connects -- must NOT be replayed.
    await post(handle.url, { event: "before_connect", payload: { n: 0 } });

    const streamResponse = await fetch(`${handle.url}/events/stream`);
    expect(streamResponse.body).not.toBeNull();

    const eventsPromise = readSseEvents(streamResponse.body!, 2);

    await post(handle.url, { event: "first", payload: { n: 1 } });
    await post(handle.url, { event: "second", payload: { n: 2 } });

    const events = await eventsPromise;
    expect(events.map((event) => event.event)).toEqual(["first", "second"]);
    expect(events.map((event) => event.payload)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("releases the subscription when the client disconnects (aborted request)", async () => {
    handle = await startDevServer({ startPort: 4980 });

    const before = handle.getSubscriberCount();

    const controller = new AbortController();
    const streamResponse = await fetch(`${handle.url}/events/stream`, { signal: controller.signal });
    expect(streamResponse.body).not.toBeNull();
    // Pull once so the connection is fully established before we abort it.
    const reader = streamResponse.body!.getReader();

    expect(handle.getSubscriberCount()).toBe(before + 1);

    controller.abort();
    await reader.cancel().catch(() => undefined);

    // Give the server a tick to process the disconnect and run cancel().
    await Bun.sleep(50);

    expect(handle.getSubscriberCount()).toBe(before);

    // A subsequent POST must not hang or throw now that the subscriber is gone.
    const postResponse = await post(handle.url, { event: "after_disconnect" });
    expect(postResponse.status).toBe(200);
  });

  it("broadcasts events to 2+ concurrent SSE clients independently and in order", async () => {
    handle = await startDevServer({ startPort: 4990 });

    const first = await fetch(`${handle.url}/events/stream`);
    const second = await fetch(`${handle.url}/events/stream`);
    expect(first.body).not.toBeNull();
    expect(second.body).not.toBeNull();

    const firstEvents = readSseEvents(first.body!, 2);
    const secondEvents = readSseEvents(second.body!, 2);

    await post(handle.url, { event: "alpha", payload: { n: 1 } });
    await post(handle.url, { event: "beta", payload: { n: 2 } });

    const [resultFirst, resultSecond] = await Promise.all([firstEvents, secondEvents]);

    expect(resultFirst.map((event) => event.event)).toEqual(["alpha", "beta"]);
    expect(resultSecond.map((event) => event.event)).toEqual(["alpha", "beta"]);
  });
});
