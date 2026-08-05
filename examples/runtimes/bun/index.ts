import { createAnalytics } from "typetrack";
import { createSegmentFetchProvider } from "@typetrack/provider-segment";

// The one subdirectory of `examples/runtimes/` genuinely run and tested in
// this repo (Bun is already this repo's own toolchain, per `CLAUDE.md`) --
// see `../cloudflare-worker`/`../vercel-edge`/`../deno` for the three
// source-plus-README-only siblings this contrasts with, and
// `examples/runtimes/README.md` for why.
//
// Uses `createSegmentFetchProvider` (`@typetrack/provider-segment`) -- this
// phase's new, zero-vendor-dependency, `fetch()`-only Segment adapter
// variant -- pointed at a local `Bun.serve()` stand-in for Segment's HTTP
// Tracking API (`startSegmentStub` below), never real Segment
// infrastructure, so this file is safe to `bun run` directly with no
// credentials or network access to a real vendor required. Demonstrates
// Bun's own runtime story for this phase: `import { createSegmentFetchProvider
// } from "@typetrack/provider-segment"` is a direct, unmodified,
// Node-compatible ES module import -- no `npm:`-style specifier (Deno-only,
// see `../deno`) or bundler config is needed, because Bun implements the
// same module resolution/`fetch`/`Bun.serve()` globals this adapter and its
// test double both rely on natively.

export interface CartItem {
  sku: string;
  price: number;
  quantity: number;
}

// Pure helper functions -- no I/O, straightforward to unit-test in
// isolation (see `index.test.ts`). Mirrors
// `examples/core/provider-switch/app.ts`'s own
// `buildCheckoutStartedPayload`/`buildPurchaseCompletedPayload` convention:
// realistic per-event payload shaping kept separate from any provider/
// transport concern.
export function buildProductViewedProperties(item: Pick<CartItem, "sku" | "price">): Record<string, unknown> {
  return { sku: item.sku, price: item.price };
}

export function buildCheckoutStartedProperties(items: CartItem[]): { cartTotal: number; itemCount: number } {
  const rawTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  // Rounds to 2 decimal places -- avoids floating-point artifacts (e.g.
  // `14.5 * 2 + 54 = 83.00000000000001`) leaking into the tracked payload.
  return { cartTotal: Math.round(rawTotal * 100) / 100, itemCount };
}

export interface SegmentStubRequest {
  method: string;
  pathname: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

export interface SegmentStub {
  url: string;
  requests: SegmentStubRequest[];
  stop(): void;
}

// A minimal local stand-in for Segment's HTTP Tracking API, built on Bun's
// native `Bun.serve()` -- mirrors
// `examples/core/provider-switch/ga4-stub-server.ts`'s `startGA4Stub()`
// convention exactly (same shape, different vendor). `port: 0` binds an
// OS-assigned local port; never talks to real Segment infrastructure.
export function startSegmentStub(): SegmentStub {
  const requests: SegmentStubRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = (await req.json()) as Record<string, unknown>;
      requests.push({
        method: req.method,
        pathname: url.pathname,
        authorization: req.headers.get("authorization"),
        body,
      });
      return new Response(null, { status: 200 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop() {
      server.stop(true);
    },
  };
}

function makeLog(sink: string[]): (message: string) => void {
  return (message) => {
    sink.push(message);
    console.log(message);
  };
}

export interface BunRuntimeTrackingFlowResult {
  // Every log line produced across the flow, in the exact order `bun run
  // index.ts` prints them -- what `expected-output.txt` captures.
  sink: string[];
  // Every HTTP request the local Segment stub actually received, in
  // arrival order.
  requests: SegmentStubRequest[];
}

// The example's real entry point: constructs a real, fetch-based
// `AnalyticsProvider` (`createSegmentFetchProvider`) pointed at a local
// HTTP stub, tracks a small realistic storefront session, and returns
// everything both `bun run index.ts` prints and the stub actually received
// -- so `index.integration.test.ts` asserts against genuine end-to-end HTTP
// round trips, never a re-implemented copy of this logic. Exported (rather
// than only run inline) for exactly that reason.
export async function runBunRuntimeTrackingFlow(): Promise<BunRuntimeTrackingFlowResult> {
  const sink: string[] = [];
  const log = makeLog(sink);

  const stub = startSegmentStub();
  try {
    log(`[bun-runtime] local Segment-HTTP-API stub listening at ${stub.url} (never real Segment infrastructure)`);

    const provider = createSegmentFetchProvider({
      writeKey: "bun-runtime-example-write-key",
      host: stub.url,
    });
    log(
      "[bun-runtime] createSegmentFetchProvider constructed -- zero vendor dependency, plain fetch() -- " +
        "runs identically under Bun, Node 18+, browsers, and edge runtimes",
    );

    const analytics = createAnalytics({ provider });

    await analytics.identify("user_bun_512", { plan: "team" });
    log('[bun-runtime] identify("user_bun_512", { plan: "team" })');

    const cart: CartItem[] = [
      { sku: "TT-HOODIE-CHARCOAL-L", price: 54.0, quantity: 1 },
      { sku: "TT-MUG-STEEL", price: 14.5, quantity: 2 },
    ];

    const productViewedProperties = buildProductViewedProperties(cart[0]!);
    await analytics.track("Product Viewed", productViewedProperties);
    log(`[bun-runtime] track("Product Viewed", ${JSON.stringify(productViewedProperties)})`);

    const checkoutStartedProperties = buildCheckoutStartedProperties(cart);
    await analytics.track("Checkout Started", checkoutStartedProperties);
    log(`[bun-runtime] track("Checkout Started", ${JSON.stringify(checkoutStartedProperties)})`);

    await analytics.flush();
    await analytics.destroy();
    log(`[bun-runtime] flush() + destroy() complete -- ${stub.requests.length} requests reached the local stub`);

    return { sink, requests: stub.requests };
  } finally {
    stub.stop();
  }
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runBunRuntimeTrackingFlow();
}
