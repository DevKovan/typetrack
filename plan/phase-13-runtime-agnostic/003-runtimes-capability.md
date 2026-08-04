# 003 — `ProviderCapabilities.runtimes`: truthful, declarative runtime-support metadata

## Context

Depends on issues 001/002 only in that it backfills their new adapters
too (no code dependency — could technically be implemented in parallel,
but do it after so the fetch-based adapters already exist to declare
against). Read `src/providers/index.ts`'s existing `batching`/`batch`
capability-flag comments in full first — this issue adds a field
following the exact same "declared truthfully, opaque to core, purely
descriptive" pattern.

## Scope of this issue

- Add `runtimes?: Array<"node" | "browser" | "edge" | "bun" | "deno">` to
  `ProviderCapabilities` in `src/providers/index.ts`, with a doc comment
  explaining: (a) this is purely descriptive metadata for an app author
  choosing an adapter for a given deployment target — core never reads or
  branches on it, exactly like `batching`; (b) optional, so no
  pre-existing provider/test breaks; (c) `"edge"` covers both Cloudflare
  Workers and Vercel Edge Functions (and similar V8-isolate-based
  runtimes) as one category, since they share the same relevant
  constraint (no Node-specific globals, `fetch`-only), not because they
  are identical runtimes in every other respect — document this framing
  explicitly so a reader understands why there isn't a separate
  `"cloudflare-workers"` / `"vercel-edge"` distinction.
- Backfill `runtimes` on every existing `AnalyticsProvider` factory:
  - `packages/provider-ga4`: `["node", "browser", "edge", "bun", "deno"]`
    — already fetch-based, no Node-specific API usage (confirm this by
    actually reading its full source, not assuming from the BRIEF's
    summary).
  - `packages/provider-posthog`'s new `createPostHogFetchProvider` and
    `packages/provider-segment`'s new `createSegmentFetchProvider`
    (issues 001/002): `["node", "browser", "edge", "bun", "deno"]` — same
    reasoning, they're bare `fetch()` adapters.
  - `packages/provider-posthog`'s existing `createPostHogProvider` and
    `packages/provider-segment`'s existing `createSegmentProvider`
    (SDK-based): **research required** — read the installed `posthog-node`
    and `@segment/analytics-node` package's own source/README/package.json
    `exports` field (in `node_modules/`, after `bun install`) to determine
    whether either SDK internally relies on Node-only APIs (`node:http`/
    `node:https`/`node:net`/`node:fs`/`process`, etc.) or is itself built
    on `fetch` under the hood. Declare `runtimes` truthfully based on
    actual findings, not assumption — likely `["node", "bun", "deno"]`
    (excluding `"browser"`/`"edge"`) if either SDK uses Node-only
    transport internals, but **verify, don't guess**; if a vendor SDK
    turns out to already support `fetch`-based/edge transport in the
    installed version, declare accordingly and note the finding in a code
    comment citing what was checked.
- Document the findings from the research step above in a short paragraph
  within each affected file's existing top-of-file comment block (not a
  separate doc file) — e.g. "Verified against posthog-node 5.x's
  `lib/index.node.ts`: uses `node:https` internally for its default HTTP
  client, so this factory is Node/Bun/Deno-only."

## Design decisions made in this issue

- **`"edge"` is one shared category, not split per-vendor.** Splitting it
  into `"cloudflare-workers"`/`"vercel-edge"`/etc. would require this
  phase to actually verify compatibility against each vendor's specific
  isolate constraints individually, which is disproportionate given the
  real, shared constraint (`fetch`-only, no Node globals) is identical
  across them — a provider that's edge-compatible in this sense works
  across all of them; a genuine per-vendor incompatibility (rare, and not
  known to apply to anything in this codebase) would be a future,
  narrower addition if it's ever actually needed.
- **Research-driven, not templated, for the SDK-based adapters.** It
  would be easy (and wrong) to reflexively mark both SDK-based adapters
  `["node"]`-only without checking — Bun and Deno both have substantial
  Node-API compatibility layers, so "uses `node:https`" does not
  automatically mean "Bun/Deno-incompatible"; this issue requires an
  actual verification step (running the adapter's existing test suite
  under consideration, or at minimum reading the SDK's own documented
  runtime support) rather than a guess in either direction.

## Acceptance criteria

- `ProviderCapabilities.runtimes` is present, optional, documented per
  the above.
- All five adapter factories (`createGA4Provider`,
  `createPostHogProvider`, `createPostHogFetchProvider`,
  `createSegmentProvider`, `createSegmentFetchProvider`) declare
  `runtimes` with a value backed by an actual, cited verification step
  (visible in a code comment), not a copy-pasted guess.
- No existing test for any of the five factories' `capabilities` object
  breaks (this is a strictly additive field to an object most existing
  tests likely assert via a subset match or explicit full-object
  equality — check and adjust any exact-equality assertions that would
  now fail purely because of the new key, without changing their actual
  assertions' intent).

## Test requirements

Unit tests only, extending each affected package's existing test file
for its `capabilities` object (`packages/provider-ga4/src/index.test.ts`,
`packages/provider-posthog/src/index.test.ts` +
`fetch.test.ts` (from issue 001), `packages/provider-segment/src/
index.test.ts` + `fetch.test.ts` (from issue 002)) — assert the exact
`runtimes` array each factory declares.

## Out of scope

- Any core (`src/`) logic that reads or gates on `runtimes` — purely
  descriptive, per design decision 1/4 in BRIEF.md.
- SSR-safety test coverage (a distinct, behavior-verifying concern from
  this issue's purely-declarative metadata) — issue 004.
- `examples/runtimes/` — issue 005.
