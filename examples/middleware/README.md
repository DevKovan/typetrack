# examples/middleware

Runnable, self-contained demonstrations of `typetrack`'s middleware pipeline:
registering `Middleware`s onto an `Analytics` instance via `.use()`, the
`before`/`after`/`onError` hooks, the locked before(all)->dispatch->after(all)
execution order and error-handling contract, and all six built-ins
(`redactMiddleware`, `samplingMiddleware`, `loggingMiddleware`,
`enrichmentMiddleware`, `versionMiddleware`, `timingMiddleware`).

Per `plan/VISION.md`'s Examples policy, every feature ships its `examples/`
entries in the same phase that built it, so these never drift out of sync
with what's actually shipped -- each example's integration test imports and
runs the example's own real entry point/app logic (never a re-implemented
copy of it) against the real `typetrack` API, so a future change to the
middleware pipeline that breaks an example's assumptions fails that
example's tests, not just its prose.

None of `examples/` is part of any published npm package: it's excluded from
every package's `files`/`exports` and from `bun run build:all`/`tsup`'s
build steps -- this is documentation/demo code for people reading the repo
or running it locally, not shipped library code.

## Examples

- **[`pipeline-basics/`](./pipeline-basics)** -- a single realistic checkout
  flow demonstrating basic usage of one built-in (`versionMiddleware`),
  order-dependent composition of several together
  (`enrichmentMiddleware` + `redactMiddleware` + `loggingMiddleware`, plus a
  purpose-built validation guard), the literal before(all)->dispatch->
  after(all) execution order, and both error-handling scenarios: a
  middleware's `before()` throwing (`onError`, `source: "middleware"`) and a
  provider's dispatch rejecting (`onError`, `source: "provider"`).
- **[`sampling-vs-routing/`](./sampling-vs-routing)** -- clarifies the
  two-layer sampling distinction between `samplingMiddleware` (this phase --
  a global, pre-dispatch gate) and Phase 7's `ProviderEntry.sampling` (a
  per-provider gate) on a realistic multi-provider search-tracking setup,
  showing that a global drop removes an event from every provider at once,
  while per-provider sampling only ever excludes the one provider it's
  configured on.

Every example includes a `README.md` with source excerpts, the literal
expected output, an explanation of why the output looks the way it does, and
production notes (including performance notes on middleware's synchronous,
linear-cost hot-path execution) -- and both a unit test (for the one piece of
non-trivial pure logic each example defines) and an integration test (running
the example's real entry point end to end against hand-written stub
providers, never live vendor infrastructure).
