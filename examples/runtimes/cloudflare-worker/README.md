# cloudflare-worker

A minimal, realistic Cloudflare Worker `fetch` handler using `typetrack`
and `@typetrack/provider-ga4`'s `createGA4Provider` (GA4's Measurement
Protocol is a plain HTTP API -- no vendor SDK, `fetch`-only, verified
runtime-agnostic; see that package's own `runtimes` capability research)
to track a `"Product Viewed"` event per incoming request, correctly using
`ctx.waitUntil()` so the event's `flush()` isn't cancelled the instant the
`Response` is returned.

## Testing

**Not exercised by this repo's own CI/`bun test` suite.** Per
`plan/phase-13-runtime-agnostic/BRIEF.md` decision 5, this repo does not add
`wrangler` (or any Cloudflare-specific tooling) as a devDependency anywhere
in the monorepo (`CLAUDE.md`: "toolchain is devDependencies only:
Bun/tsgo/typescript/oxlint/Knip/tsup"). Nothing in this directory is
installed, type-checked, or run by `bun install`/`bun test`/`bun run
typecheck` at the repo root -- a passing `bun test` at the repo root proves
nothing about whether this Worker actually runs.

## Prerequisites

- A Cloudflare account.
- The `wrangler` CLI, installed by *you*, in *your own* project -- not by
  this repo (`npm install -D wrangler`, or `npm install -g wrangler`).
- Your own project with `typetrack` and `@typetrack/provider-ga4` installed
  as dependencies (`npm install typetrack @typetrack/provider-ga4`).
- A real GA4 property's Measurement ID and API secret (Google Analytics
  Admin -> Data Streams -> your stream -> Measurement Protocol API secrets).

## How to run

Copy `src/index.ts` and `wrangler.toml` into your own Worker project
(adjusting `wrangler.toml`'s `[vars]`/secrets to your own GA4 credentials),
then:

```sh
# Local dev server, against real Google infrastructure by default:
wrangler dev

# Deploy to Cloudflare:
wrangler secret put GA4_API_SECRET
wrangler deploy
```

## Source

The handler constructs a fresh `Analytics` instance per request (see
`src/index.ts`'s own comment for why a per-request singleton is a
reasonable choice inside a Worker's reused-isolate scope, unlike
`../vercel-edge`'s per-invocation isolates), tracks one event, then keeps
the delivery alive past the returned `Response`:

```ts
const analytics = createAnalytics({
  provider: createGA4Provider({
    measurementId: env.GA4_MEASUREMENT_ID,
    apiSecret: env.GA4_API_SECRET,
  }),
});

await analytics.track("Product Viewed", { sku, path: url.pathname });

ctx.waitUntil(analytics.flush());

return new Response(JSON.stringify({ ok: true }), { status: 200, ... });
```

## Explanation

GA4's Measurement Protocol adapter (`createGA4Provider`) issues its own
`fetch()` request immediately on every `track()` call -- there's no
client-side queue to drain, so `analytics.flush()` here is a no-op *beyond*
whatever that in-flight `track()` request is still doing. The `await
analytics.track(...)` call above already waits for that request to
complete before the handler proceeds, so in this specific example
`ctx.waitUntil(analytics.flush())` is a belt-and-suspenders correctness
habit rather than strictly required -- but it becomes essential the moment
a Worker either (a) doesn't `await` `track()` itself (fire-and-forget,
common for "don't let analytics slow down the response" handlers) or (b)
uses a provider with `capabilities.offline`/an actual reliability queue
behind it, where `flush()` genuinely has queued work left to drain. Getting
into the habit of always passing `flush()` (or any pending analytics work)
to `ctx.waitUntil()` -- never leaving it as a bare, un-awaited call -- is
what prevents intermittently-dropped events once a Worker's analytics code
changes shape.

## Production notes

- **`ctx.waitUntil()` is the correctness-critical piece.** Cloudflare's own
  Workers Runtime APIs documentation describes `ExecutionContext.waitUntil
  (promise)` as extending "the lifetime of the Worker... until the promise
  ... has settled", specifically calling out tasks like "sending analytics"
  as the intended use case
  (https://developers.cloudflare.com/workers/runtime-apis/context/, `Async
  context` topics, `waitUntil()` -- cited to the best of this repo's
  knowledge as of writing; verify against Cloudflare's current docs before
  relying on this). A `fetch()` call issued without either being `await`ed
  directly or passed to `waitUntil()` may be silently cancelled once the
  response is sent -- Workers don't guarantee an un-awaited, non-`waitUntil`
  promise runs to completion.
- **Secrets never belong in `wrangler.toml`'s `[vars]`.** `GA4_API_SECRET`
  must be set via `wrangler secret put`, not committed to source -- see
  `wrangler.toml`'s own comment.
- **A fresh `Analytics` instance per request is a deliberate, safe choice
  here, not a missing optimization.** `createAnalytics()`'s own
  construction does no network I/O, and `createGA4Provider` opens no
  persistent connection -- so there is no meaningful cost being paid by
  skipping a module-level singleton, in exchange for a handler with zero
  shared mutable state across concurrent requests in the same isolate.
