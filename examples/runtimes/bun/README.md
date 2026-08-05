# runtimes/bun

Demonstrates `typetrack` and `@typetrack/provider-segment`'s
`createSegmentFetchProvider` (this phase's new, zero-vendor-dependency,
`fetch()`-only Segment adapter variant) running directly under Bun, with a
real, local HTTP round trip: a small realistic storefront session
(`identify()`, `track("Product Viewed", ...)`, `track("Checkout Started",
...)`) is sent over genuine HTTP requests to a `Bun.serve()`-backed
stand-in for Segment's HTTP Tracking API -- never real Segment
infrastructure.

**Unlike [`../cloudflare-worker`](../cloudflare-worker),
[`../vercel-edge`](../vercel-edge), and [`../deno`](../deno), this
directory IS wired into this repo's own test suite.** Bun is already this
repo's own toolchain (`CLAUDE.md`), so -- unlike those three -- this
example is installed by `bun install` at the repo root, and its tests run
as part of this repo's own `bun test`.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends
  on the local, in-repo `typetrack`/`@typetrack/provider-segment` packages
  via `file:../../..`/`workspace:*`, not published npm versions).

## How to run

```sh
cd examples/runtimes/bun
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/runtimes/bun/index.ts
```

## Source

`index.ts`'s `runBunRuntimeTrackingFlow()` starts a local `Bun.serve()`
stand-in for Segment's HTTP Tracking API (`startSegmentStub()`, mirroring
`examples/core/provider-switch/ga4-stub-server.ts`'s own convention), then
constructs the real fetch-based adapter pointed at it:

```ts
const stub = startSegmentStub();
const provider = createSegmentFetchProvider({
  writeKey: "bun-runtime-example-write-key",
  host: stub.url,
});
const analytics = createAnalytics({ provider });

await analytics.identify("user_bun_512", { plan: "team" });
await analytics.track("Product Viewed", buildProductViewedProperties(cart[0]));
await analytics.track("Checkout Started", buildCheckoutStartedProperties(cart));
await analytics.flush();
await analytics.destroy();
```

`buildProductViewedProperties`/`buildCheckoutStartedProperties` are this
example's own pure helper functions (cart-total/item-count arithmetic,
including floating-point rounding) -- see `index.test.ts` for their
isolated unit tests, and `index.integration.test.ts` for the real
end-to-end HTTP assertions against `startSegmentStub()`'s recorded
requests.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
capture of `bun run index.ts`'s output (with one documented exception: the
local stub's OS-assigned port number differs per run -- see that file's own
header).

## Explanation

`startSegmentStub()` binds an OS-assigned local port (`Bun.serve({ port: 0,
... })`) and records every request it receives (method, pathname,
`Authorization` header, parsed JSON body) before responding `200`.
`createSegmentFetchProvider` is pointed at that local URL via its `host`
config option -- the exact same override mechanism
`../../../core/provider-switch/run-with-ga4-local-stub.ts` uses for GA4 --
so every one of this flow's 3 provider calls (`identify()`, and the two
`track()` calls) becomes a genuine `fetch()` POST over a real local socket,
not a mocked `globalThis.fetch`.

`identify("user_bun_512", { plan: "team" })` is the only verb that updates
core's own current `userId` (`src/index.ts`) -- both subsequent `track()`
calls' requests carry `userId: "user_bun_512"` in their body, alongside the
instance's own randomly-generated `anonymousId`, exactly matching how a
real Segment-backed app's identity stitching works. `"Product Viewed"`/
`"Checkout Started"` both map to themselves under
`@typetrack/provider-segment`'s default event-name map (Segment's
Ecommerce v2 / B2B SaaS spec names those events identically to their
canonical names) -- see `packages/provider-segment/src/mapping.ts`'s
`DEFAULT_EVENT_MAP` for the full table. `sku`/`price` (on `"Product
Viewed"`) and `cartTotal`/`itemCount` (on `"Checkout Started"`) have no
default property-name mapping entries for these particular keys, so they
pass through the request body unchanged.

## Production notes

- **This is a local HTTP stub, not a mock of Segment's full validation
  behavior.** `startSegmentStub()` only records the shape of requests it
  receives and returns `200` unconditionally -- it does not enforce
  Segment's real request-size limits, rate limits, or payload validation
  the way live infrastructure would. Swap `host` back to its default
  (`https://api.segment.io`, i.e. omit the option) and supply a real write
  key to talk to actual Segment infrastructure.
- **A bare `fetch()`-based adapter like this one has no client-side
  queue/retry of its own** -- every call above already issues and awaits
  its own immediate request. Phase 12's reliability queue
  (`src/reliability/`, via the `reliability` `createAnalytics()` option) is
  the natural pairing partner if you want retry/offline-queueing behavior
  on top of it; this example stays minimal and doesn't enable it.
- **Bun's own runtime story for this phase is the simplest of the four:**
  `import { createSegmentFetchProvider } from "@typetrack/provider-segment"`
  is a direct, unmodified, Node-compatible ES module import -- no
  `npm:`-style specifier (Deno-only, see `../deno`), no bundler
  configuration, no edge-runtime `waitUntil`/per-request-instance
  considerations (see `../cloudflare-worker`/`../vercel-edge`'s own
  Production notes) -- because Bun implements the same module resolution,
  `fetch`, and `Bun.serve()` globals this adapter and its local test double
  both rely on natively.
