import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { DevServerEvent, DevServerListener } from "./server";
import { createSseUnderlyingSource, encodeSseEvent, SSE_KEEPALIVE_MS } from "./sse";

const decoder = new TextDecoder();

function fakeEvent(overrides: Partial<DevServerEvent> = {}): DevServerEvent {
  return { event: "signup_completed", payload: { plan: "pro" }, timestamp: 1700000000000, valid: true, ...overrides };
}

// A stand-in for 002's `subscribe()`: records the listener it was given and
// exposes a spy-wrapped unsubscribe, without any real event-emitter/network
// machinery.
function fakeSubscribeSource() {
  let listener: DevServerListener | undefined;
  const unsubscribe = mock(() => {
    listener = undefined;
  });
  const subscribe = mock((next: DevServerListener) => {
    listener = next;
    return unsubscribe;
  });
  return {
    subscribe,
    unsubscribe,
    emit(event: DevServerEvent) {
      listener?.(event);
    },
  };
}

class FakeController {
  enqueued: Uint8Array[] = [];
  enqueue(chunk: Uint8Array): void {
    this.enqueued.push(chunk);
  }
  get frames(): string[] {
    return this.enqueued.map((chunk) => decoder.decode(chunk));
  }
}

describe("encodeSseEvent", () => {
  it("serializes an event into a single `data: <json>\\n\\n` SSE frame", () => {
    const event = fakeEvent();
    const frame = decoder.decode(encodeSseEvent(event));
    expect(frame).toBe(`data: ${JSON.stringify(event)}\n\n`);
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});

describe("createSseUnderlyingSource", () => {
  let clearIntervalSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    clearIntervalSpy = spyOn(globalThis, "clearInterval");
  });

  afterEach(() => {
    clearIntervalSpy.mockRestore();
  });

  it("subscribes on start(), sends an immediate keepalive frame, and enqueues one `data: ...\\n\\n` frame per received event", () => {
    const fake = fakeSubscribeSource();
    const source = createSseUnderlyingSource(fake.subscribe);
    const controller = new FakeController();

    source.start?.(controller as unknown as ReadableStreamDefaultController<Uint8Array>);
    expect(fake.subscribe).toHaveBeenCalledTimes(1);
    // An immediate `:ping\n\n` is sent on connect -- Bun buffers response
    // headers until the stream's first `enqueue()`, so without this the
    // client wouldn't observe the connection opening until the first real
    // event or the first keepalive tick.
    expect(controller.frames).toEqual([":ping\n\n"]);

    const event = fakeEvent({ event: "page_viewed" });
    fake.emit(event);

    expect(controller.frames).toEqual([":ping\n\n", `data: ${JSON.stringify(event)}\n\n`]);
  });

  it("does not enqueue any data frame for events emitted before start() subscribes", () => {
    const fake = fakeSubscribeSource();
    // Emitting before start() is a no-op since no listener is registered yet
    // -- mirrors "no replay of buffered history" from the caller's side.
    fake.emit(fakeEvent());
    const source = createSseUnderlyingSource(fake.subscribe);
    const controller = new FakeController();
    source.start?.(controller as unknown as ReadableStreamDefaultController<Uint8Array>);

    expect(controller.frames).toEqual([":ping\n\n"]);
  });

  it("enqueues a `:ping\\n\\n` comment frame on the keepalive interval", () => {
    const fake = fakeSubscribeSource();
    const source = createSseUnderlyingSource(fake.subscribe, 1000);
    const controller = new FakeController();

    const setIntervalSpy = spyOn(globalThis, "setInterval");
    try {
      source.start?.(controller as unknown as ReadableStreamDefaultController<Uint8Array>);
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(1000);

      // Invoke the interval callback directly rather than relying on real
      // timers ticking.
      const callback = setIntervalSpy.mock.calls[0]?.[0] as () => void;
      callback();
    } finally {
      setIntervalSpy.mockRestore();
      source.cancel?.(undefined);
    }

    expect(controller.frames).toEqual([":ping\n\n", ":ping\n\n"]);
  });

  it("uses SSE_KEEPALIVE_MS as the default keepalive interval", () => {
    const fake = fakeSubscribeSource();
    const source = createSseUnderlyingSource(fake.subscribe);
    const controller = new FakeController();

    const setIntervalSpy = spyOn(globalThis, "setInterval");
    try {
      source.start?.(controller as unknown as ReadableStreamDefaultController<Uint8Array>);
      expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(SSE_KEEPALIVE_MS);
    } finally {
      setIntervalSpy.mockRestore();
      source.cancel?.(undefined);
    }
  });

  it("cancel() calls the unsubscribe function returned by subscribe() exactly once and clears the keepalive interval", () => {
    const fake = fakeSubscribeSource();
    const source = createSseUnderlyingSource(fake.subscribe);
    const controller = new FakeController();

    source.start?.(controller as unknown as ReadableStreamDefaultController<Uint8Array>);
    source.cancel?.(undefined);

    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // Cancelling twice must not double-unsubscribe or double-clear.
    source.cancel?.(undefined);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("no longer enqueues frames for events emitted after cancel()", () => {
    const fake = fakeSubscribeSource();
    const source = createSseUnderlyingSource(fake.subscribe);
    const controller = new FakeController();

    source.start?.(controller as unknown as ReadableStreamDefaultController<Uint8Array>);
    const framesAfterStart = controller.frames.length;
    source.cancel?.(undefined);
    fake.emit(fakeEvent());

    expect(controller.frames).toHaveLength(framesAfterStart);
  });
});
