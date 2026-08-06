# examples/validation

Runnable, self-contained demonstrations of Phase 15's validation-hardening
surface: `validate` (production-safe stripping of runtime schema checks),
`deprecatedEvents` (visible, timed event-rename migrations), and
`schemaVersion` (a tracking-plan version tag, plus the additive-vs-breaking
schema-evolution discipline it's meant to support).

Per `plan/VISION.md`'s Examples policy, every feature ships its `examples/`
entries in the same phase that built it, so these never drift out of sync
with what's actually shipped -- each example's integration test imports and
runs the example's own real entry point/app logic (never a re-implemented
copy of it) against the real `typetrack` API, so a future change to this
surface that breaks an example's assumptions fails that example's tests, not
just its prose.

None of `examples/` is part of any published npm package: it's excluded from
every package's `files`/`exports` and from `bun run build:all`/`tsup`'s
build steps -- this is documentation/demo code for people reading the repo
or running it locally, not shipped library code.

## Examples

- **[`production-stripping/`](./production-stripping)** -- issue 003's
  `validate` option, wired to a simulated bundler env check
  (`IS_PRODUCTION`). Shows a malformed payload caught by one
  `createAnalytics()` instance and passed through unvalidated by another, and
  explains the two-part reality of production bundle stripping: `validate:
  false` alone only skips the runtime check, not the bundle size -- actually
  shrinking the bundle also requires guarding the `schemas` reference itself
  the same way, a documented, accepted industry limitation (not a typetrack
  gap).
- **[`deprecated-event-rename/`](./deprecated-event-rename)** -- issues
  001/002's `deprecatedEvents` option, on a realistic snake_case ->
  Title Case tracking-plan rename (`"checkout_started"` ->
  `"Checkout Started"`). Shows an old call site continuing to work
  unmodified, the console warning firing exactly once across multiple calls,
  and the provider receiving every event under the new, resolved name --
  `plan/VISION.md`'s Golden Rule ("one config file, not an application-code
  sweep") applied to event naming.
- **[`schema-versioning/`](./schema-versioning)** -- issue 004's
  `schemaVersion` tag plus the additive-vs-breaking schema-evolution
  discipline: a `"Purchase Completed"` schema at `schemaVersion: "2026.1"`
  gaining an optional field with no version bump, and a labeled section
  showing a genuine breaking change (a field rename/meaning change) done
  correctly -- a new event name, a new schema, and a `schemaVersion` bump,
  never an in-place mutation of what an existing field means.

Every example includes a `README.md` with source excerpts, the literal
expected output, an explanation of why the output looks the way it does, and
production notes -- and both a unit test (for the pure, non-trivial logic
each example defines) and an integration test (running the example's real
entry point end to end against hand-written stub providers and real Zod
schemas, never live vendor infrastructure).
