# 005 -- `examples/validation/`: production stripping, deprecated-event rename, schema versioning

## Context

Depends on issues 001-004 all being landed (uses `deprecatedEvents`,
`validate`, `schemaVersion` for real, against a real `createAnalytics()`
instance). Follows `examples/middleware/`'s exact package shape (read
`examples/middleware/sampling-vs-routing/` -- `package.json`, `README.md`,
`index.ts`, `index.test.ts`, `index.integration.test.ts`,
`expected-output.txt` -- in full as the template) and
`examples/middleware/README.md`'s top-level index style for this
directory's own `examples/validation/README.md`.

Per VISION.md's "Examples -- mandatory, per-phase" policy: realistic event
names only (no `test`/`foo`/`bar`), README + source + expected output +
explanation + production notes per example.

## Scope of this issue

Three sibling example packages under `examples/validation/`:

1. **`examples/validation/production-stripping`** -- demonstrates issue
   003's `validate` option wired to a simulated bundler env check (`const
   IS_PRODUCTION = process.env.NODE_ENV === "production";` at the top of
   `index.ts`, standing in for what a real app's bundler would statically
   replace). Shows two `createAnalytics()` instances side by side: one
   with `validate: true` (or omitted) catching a malformed payload and
   throwing `EventValidationError`, one with `validate: false` letting the
   same malformed payload through unvalidated to a stub provider. README's
   "Production notes" section must explain, explicitly, the two-part
   reality issue 003's doc comment already states: (a) `validate: false`
   alone only skips the *runtime check* -- it does not by itself shrink
   the production bundle; (b) actually removing the `schemas` object (and
   whatever validation library built it) from a production bundle
   additionally requires the app to guard the *import*/reference to that
   object the same way (e.g. `schemas: IS_PRODUCTION ? undefined :
   realSchemas`), so the app's bundler's dead-code elimination has
   something staticaly-`false`-guarded to actually remove -- cite this as
   a documented, accepted industry limitation (not a typetrack gap), per
   BRIEF.md's research-grounding section.
2. **`examples/validation/deprecated-event-rename`** -- a realistic
   rename scenario: an app originally shipped `"checkout_started"`
   (snake_case, an early convention) and is migrating its whole tracking
   plan to Title Case event names (`"Checkout Started"`), per this repo's
   own `event_taxonomy`-adjacent guidance already referenced elsewhere in
   `plan/`. `deprecatedEvents: { checkout_started: { replacement:
   "Checkout Started", sunsetDate: "2027-01-01" } }`. Shows: an old call
   site (`analytics.track("checkout_started", { cartValue: 42 })`)
   continuing to compile and run unmodified, the console warning firing
   exactly once even across multiple calls, and a stub provider receiving
   the event as `"Checkout Started"`. README explains the "one config
   file, not an application-code sweep" framing directly (ties back to
   VISION.md's Golden Rule).
3. **`examples/validation/schema-versioning`** -- demonstrates issue 004's
   `schemaVersion` tag plus the additive-evolution discipline from BRIEF.md
   Design decision 3: a `"Purchase Completed"` schema at
   `schemaVersion: "2026.1"` with `{ orderId: z.string(), total:
   z.number() }`, then a narrated "later, additively" section showing the
   *same* event gaining an optional `currency: z.string().optional()`
   field without a version bump (an additive, backward-compatible change),
   and a separate, clearly-labeled section showing what a *breaking*
   change looks like done correctly (renaming `total` to `amountCents`)
   -- via `deprecatedEvents`-style redirection to a genuinely new event
   name (`"Purchase Completed"` -> `"Purchase Completed V2"`) plus a
   `schemaVersion` bump to `"2027.1"`, rather than mutating the existing
   schema's field meaning in place. This example is intentionally more
   narrative/README-heavy than the other two (it's demonstrating a
   discipline/convention, not just one API call) -- `index.ts` should
   still be a single runnable script producing real, assertable output
   (not just prose), covering the "current version" and "additive change"
   paths at minimum; the "breaking change, correctly" path may be shown as
   a second runnable section in the same `index.ts` or a
   commented/explained code block in the README if a fully separate
   runnable scenario would be redundant with `deprecated-event-rename`'s
   own coverage -- implementor's call, document whichever is chosen.

Each of the 3 packages: `package.json` (mirrors
`examples/middleware/sampling-vs-routing/package.json` exactly --
`"typetrack": "file:../../.."`, `bun run index.ts` as `start`, `bun test`
as `test`), `README.md` (prerequisites, how to run, source walkthrough,
expected output, explanation, production notes -- per VISION.md's example
policy), `index.ts`, `index.test.ts` (unit-level, stub provider,
assertions), `index.integration.test.ts` (exercises the example's
`index.ts` exports/functions the same way, at the "integration" level
this repo's existing examples use that distinction for -- follow
`examples/middleware/sampling-vs-routing/`'s own test-file split as the
template for what goes in which file), `expected-output.txt` (the literal
stdout `bun run index.ts` produces).

Plus: `examples/validation/README.md` -- a short top-level index
(mirrors `examples/middleware/README.md`), one paragraph per sub-example
linking to its directory.

## Repo wiring

- Root `package.json`'s `"workspaces"` array gains `"examples/validation/*"`
  (the wildcard form, matching `"examples/core/*"`/`"examples/middleware/*"`
  -- not the explicit-per-directory form used by the more recent
  `examples/frameworks/*`/`examples/runtimes/bun` entries; this phase's
  examples are plain `.ts`, same category as core/middleware/plugins/
  recipes, so the wildcard precedent applies here, not the newer one).
- Root `tsconfig.json`'s `"include"` array gains `"examples/validation/*"`
  in the same style.
- No `.github/workflows/qa.yml` change needed beyond whatever `bun test`/
  `bun run typecheck` already sweep up automatically via the wildcard
  entries above (confirm this by checking how `examples/middleware/*` is
  wired into `qa.yml` today -- if it needed no dedicated step, this
  phase's examples need none either; if it did, mirror it exactly).

## Testing

Each package's own `index.test.ts`/`index.integration.test.ts` (`bun
test`, run from repo root, must pass as part of the full suite). No new
top-level test infra needed.

## Out of scope

Any Cloudflare/Vercel/npm/CDN deployment. Any change to
`examples/{core,middleware,recipes}` -- this issue is additive,
`examples/validation/`-only (plus the two wiring-array edits above).

## Done criteria for this issue (and, since it's the trailing issue, the whole phase)

From a clean checkout: `bun install`, `bun run build:all`, `bun run lint`,
`bun run typecheck`, `bun test`, `bunx knip` -- all must pass. Report:
issues completed, the final `deprecatedEvents`/`validate`/`schemaVersion`
API surface landed, the 3 example packages shipped, files changed, and
clean-checkout verification results.
