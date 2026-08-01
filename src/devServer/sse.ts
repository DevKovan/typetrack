import type { DevServerEvent, DevServerListener } from "./server";

// 15s: comfortably under the idle-connection timeouts commonly imposed by
// intermediaries (load balancers, reverse proxies) sitting in front of a
// long-lived SSE connection, while still infrequent enough not to be noisy.
export const SSE_KEEPALIVE_MS = 15_000;

const encoder = new TextEncoder();

// SSE comment frames (lines starting with `:`) are ignored by `EventSource`
// clients but still count as traffic, keeping the connection from looking
// idle to anything watching for that.
const KEEPALIVE_FRAME = encoder.encode(":ping\n\n");

export function encodeSseEvent(event: DevServerEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

type Unsubscribe = () => void;
export type Subscribe = (listener: DevServerListener) => Unsubscribe;

// Split out from the route handler so it can be exercised directly in unit
// tests against a fake `subscribe()`, with no real network layer or
// `ReadableStream` machinery involved.
export function createSseUnderlyingSource(
  subscribe: Subscribe,
  keepaliveMs: number = SSE_KEEPALIVE_MS,
): Bun.UnderlyingSource<Uint8Array> {
  let unsubscribe: Unsubscribe | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  return {
    start(controller) {
      unsubscribe = subscribe((event) => {
        controller.enqueue(encodeSseEvent(event));
      });
      // Bun buffers the response's headers until the stream's first
      // `enqueue()`, so without an immediate frame here a client wouldn't
      // see the connection open at all until the first real event or the
      // first keepalive tick -- send one right away as well as on the
      // recurring interval.
      controller.enqueue(KEEPALIVE_FRAME);
      keepalive = setInterval(() => {
        controller.enqueue(KEEPALIVE_FRAME);
      }, keepaliveMs);
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = undefined;
      if (keepalive !== undefined) clearInterval(keepalive);
      keepalive = undefined;
    },
  };
}
