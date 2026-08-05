# examples/runtimes

Demonstrates Phase 13's runtime-agnostic story: `typetrack` core and its
`fetch()`-based provider adapters (GA4's `createGA4Provider`, and the new
`createPostHogFetchProvider`/`createSegmentFetchProvider` fetch variants) run
unmodified across Node, browsers, Cloudflare Workers, Vercel Edge Functions,
Bun, and Deno, because none of them depend on anything beyond the runtime's
native `fetch` (and, for identity/auth encoding, other universally-available
globals like `btoa`/`URL` -- never a Node-only API such as `Buffer` or
`node:*`). See each adapter's own `runtimes` capability declaration
(`ProviderCapabilities.runtimes`, `src/providers/index.ts`) for the
per-adapter research this claim is based on.

## Tested-in-repo vs. source-only: read this first

This directory's shape is different from every other `examples/*` category,
and deliberately so:

- **[`bun/`](./bun) is genuinely runnable and tested in this repo.** Bun is
  already this repo's own toolchain (per `CLAUDE.md`) -- `bun/` follows the
  exact same runnable shape every other `examples/*` entry does
  (`package.json`, `index.ts`, an integration test, `expected-output.txt`),
  and its test is part of this repo's own `bun test` run.
- **[`cloudflare-worker/`](./cloudflare-worker),
  [`vercel-edge/`](./vercel-edge), and [`deno/`](./deno) are source-plus-
  README only.** Per `plan/phase-13-runtime-agnostic/BRIEF.md`'s decision 5,
  this repo does not add `wrangler`, `vercel`, or a Deno-specific test
  runner as a toolchain dependency anywhere in the repo (`CLAUDE.md`:
  "toolchain is devDependencies only: Bun/tsgo/typescript/oxlint/
  Knip/tsup"). These three subdirectories are realistic, correct,
  copy-into-your-own-project entry points a reader would deploy on the
  actual target infrastructure (a real Cloudflare account + `wrangler`, a
  real Vercel/Next.js project, a local Deno install) -- **none of it is
  exercised by `bun test` at the repo root.** Each of their own `README.md`
  files repeats this explicitly, so a passing `bun test` at the repo root
  should never be mistaken for validating these three.

## The four examples

- **[`cloudflare-worker/`](./cloudflare-worker)** -- a minimal Cloudflare
  Worker `fetch` handler (`src/index.ts`, the `ExportedHandler` shape) that
  constructs `createAnalytics({ provider: createGA4Provider(...) })` per
  incoming request and tracks a `"Product Viewed"` event, correctly using
  `ctx.waitUntil()` to keep the event's `flush()` alive past the point the
  `Response` is returned -- Workers' own request lifecycle would otherwise
  cancel that in-flight work as soon as the response is sent. Includes a
  `wrangler.toml` (a config file only -- not installed or invoked by this
  repo).
- **[`vercel-edge/`](./vercel-edge)** -- a minimal Next.js Edge Function
  (`app/api/track/route.ts`, `export const runtime = "edge"`) that
  constructs a fresh `Analytics` instance *per request* (not a module-level
  singleton -- Edge Functions are stateless, short-lived isolates, unlike a
  typical long-lived Node server process where a singleton is the normal,
  correct choice) using `createPostHogFetchProvider`, tracks a
  `"Checkout Started"` event derived from the incoming request, and awaits
  `flush()` before returning the `Response`.
- **[`bun/`](./bun)** -- a genuinely runnable, tested-in-this-repo example:
  `createAnalytics()` with `createSegmentFetchProvider` (the new,
  zero-vendor-dependency fetch variant from this phase), tracking a small
  realistic e-commerce session (`"Product Viewed"`, `"Checkout Started"`)
  against a local `Bun.serve()` stand-in for Segment's HTTP Tracking API
  (never real Segment infrastructure) -- run it directly with `bun run
  index.ts`, or see its test run as part of this repo's own `bun test`.
- **[`deno/`](./deno)** -- a minimal Deno script (`main.ts`) using Deno's
  current `npm:` specifier import syntax
  (`import { createAnalytics } from "npm:typetrack"`) to construct
  `createAnalytics({ provider: createGA4Provider(...) })` and track a
  `"Product Viewed"` event, demonstrating the same core usage pattern under
  Deno's own runtime and module system.
