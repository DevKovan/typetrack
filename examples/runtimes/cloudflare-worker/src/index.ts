// A minimal, realistic Cloudflare Worker `fetch` handler demonstrating
// `typetrack` inside a Worker: construct `createAnalytics()` with a real,
// runtime-agnostic provider (`createGA4Provider`, from
// `@typetrack/provider-ga4` -- verified `fetch`-only, no Node-specific
// global, see that package's own `runtimes` capability research), track one
// event derived from the incoming request, and correctly keep that async
// work alive past the point the `Response` is returned.
//
// NOT run by this repo's own `bun test`/CI -- see
// `examples/runtimes/README.md` and this directory's own README.md
// "Testing" note for why (per `plan/phase-13-runtime-agnostic/BRIEF.md`
// decision 5, this repo does not add `wrangler` as a toolchain dependency).
// A reader would copy this file into their own Worker project (`npm install
// typetrack @typetrack/provider-ga4`, or the adapter's published npm name
// once it ships) and run/deploy it with their own `wrangler` install.

import { createAnalytics } from "typetrack";
import { createGA4Provider } from "@typetrack/provider-ga4";

// Bindings a real Worker project would configure via `wrangler.toml`
// `[vars]`/secrets (`wrangler secret put GA4_API_SECRET`) -- see
// `wrangler.toml` alongside this file.
export interface Env {
  GA4_MEASUREMENT_ID: string;
  GA4_API_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Constructed per-request, not as a module-level singleton: a Worker's
    // top-level module scope is reused across requests within the same
    // isolate, so a singleton *would* technically survive here (unlike
    // Vercel Edge's per-invocation isolates -- see `../vercel-edge`'s own
    // README for that contrast) -- but `createAnalytics()`'s own
    // construction cost is negligible (it does no network I/O itself,
    // `createGA4Provider` opens no persistent connection), and per-request
    // construction keeps this handler stateless and trivially safe under
    // concurrent requests hitting the same isolate, with no shared mutable
    // instance to reason about.
    const analytics = createAnalytics({
      provider: createGA4Provider({
        measurementId: env.GA4_MEASUREMENT_ID,
        apiSecret: env.GA4_API_SECRET,
      }),
    });

    // `anonymousId` isn't a per-call `TrackOptions` field -- core generates
    // one `anonymousId` per `createAnalytics()` instance at construction
    // time and stamps it onto every event from that instance (see
    // `src/index.ts`). Constructing `analytics` per-request (above) means a
    // fresh `anonymousId` is generated per request here too; a real Worker
    // wanting a *stable* per-visitor id would instead read/set one from a
    // cookie and route it through `TrackOptions.context` (a request-scoped,
    // application-chosen field, not a reserved core field) for the provider
    // to read, rather than relying on core's own generated id.
    await analytics.track(
      "Product Viewed",
      { sku: url.searchParams.get("sku") ?? "unknown", path: url.pathname },
      { context: { clientIp: request.headers.get("cf-connecting-ip") ?? "unknown" } },
    );

    // Workers' request lifecycle: once a `Response` is returned from
    // `fetch()`, the runtime is free to tear down any work that hasn't been
    // explicitly kept alive -- an un-awaited `flush()` call here could be
    // cancelled before GA4's HTTP request actually completes.
    // `ctx.waitUntil(promise)` is exactly Cloudflare's documented mechanism
    // for this: "extend the lifetime of the Worker... until the promise
    // ... has settled", used for tasks like "sending analytics" (Cloudflare
    // Workers Runtime APIs docs, `ExecutionContext.waitUntil()` --
    // https://developers.cloudflare.com/workers/runtime-apis/context/).
    // Passing `analytics.flush()` (never a bare, un-awaited `track()` call)
    // is what actually guarantees the GA4 request is given the chance to
    // complete before this isolate's request handling is considered done.
    ctx.waitUntil(analytics.flush());

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;
