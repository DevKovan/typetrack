# examples/core

Runnable, self-contained demonstrations of `typetrack`'s core (non-provider,
non-plugin, non-middleware) API surface: `createAnalytics()`, the canonical
event model, and provider-agnostic application code.

Per `plan/VISION.md`'s Examples policy, every feature ships its `examples/`
entries in the same phase that built it, so these never drift out of sync
with what's actually shipped -- each example's integration test imports and
runs the example's own real entry point/app logic (never a re-implemented
copy of it) against the real `typetrack` API, so a future change to core
that breaks an example's assumptions fails that example's tests, not just
its prose.

None of `examples/` is part of any published npm package: it's excluded from
every package's `files`/`exports` and from `bun run build:all`/`tsup`'s
build steps -- this is documentation/demo code for people reading the repo
or running it locally, not shipped library code.

## Examples

- **[`canonical-event-shape/`](./canonical-event-shape)** -- what a
  `CanonicalEvent` actually looks like: a realistic signup flow
  (`track`/`identify`/`group`/`track`) against a hand-written
  console-logging provider, showing every canonical field
  (`anonymousId`/`sessionId`/`userId`/`context`/`metadata`/...) populated.
- **[`provider-switch/`](./provider-switch)** -- the same realistic checkout
  flow (`app.ts`) run against three different providers (`noopProvider`, a
  real `createGA4Provider` pointed at a local stub, and -- documented but
  not safe to run as-is -- a real `createGA4Provider` pointed at real GA4
  infrastructure), with only the provider construction differing between
  entry points. Directly demonstrates the "Prisma for Analytics" Golden
  Rule: switch providers by editing one file, not application code.

Every example includes a `README.md` with source excerpts, the literal
expected output, an explanation of why the output looks the way it does,
and production notes -- and both a unit test (for any non-trivial pure
logic) and an integration test (running the example's real entry point end
to end against `noopProvider` and/or a hand-written recording/stub
provider, never live vendor infrastructure).
