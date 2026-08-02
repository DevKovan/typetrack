# examples/providers

Runnable, self-contained demonstrations of `typetrack`'s multi-provider
fan-out and per-provider routing API surface: supplying `provider` as an
array of `ProviderEntry`s (or bare `AnalyticsProvider`s) to `createAnalytics()`,
and the `include`/`exclude`/`predicate`/`sampling`/`priority` knobs each
entry can carry.

Per `plan/VISION.md`'s Examples policy, every feature ships its `examples/`
entries in the same phase that built it, so these never drift out of sync
with what's actually shipped -- each example's integration test imports and
runs the example's own real entry point/app logic (never a re-implemented
copy of it) against the real `typetrack` API, so a future change to routing
that breaks an example's assumptions fails that example's tests, not just
its prose.

None of `examples/` is part of any published npm package: it's excluded from
every package's `files`/`exports` and from `bun run build:all`/`tsup`'s
build steps -- this is documentation/demo code for people reading the repo
or running it locally, not shipped library code.

## Examples

- **[`multi-provider-routing/`](./multi-provider-routing)** -- 4
  hand-written stub providers (`analyticsWarehouseProvider`,
  `marketingPixelProvider`, `debugConsoleProvider`, `fullFeaturedProvider`),
  each configured with a different routing mechanism (`include`, `exclude`,
  `predicate`, `sampling`) and a distinct `priority`, run through a
  realistic mix of commerce/debug/pageview events plus an always-fan-out
  `identify()` call -- shows exactly which provider(s) receive which event
  and in what order, and why.

Every example includes a `README.md` with source excerpts, the literal
expected output, an explanation of why the output looks the way it does,
and production notes -- and both a unit test (for any non-trivial pure
logic) and an integration test (running the example's real entry point end
to end against hand-written stub providers, never live vendor
infrastructure).
