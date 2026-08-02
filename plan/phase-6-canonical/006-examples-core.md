# 006 — `examples/core/` (canonical event shape + provider-switch demo)

## Context

Depends on issues 001-005 (needs the full canonical model, capability
policy, and all three rewritten adapters to exist so the provider-switch
demo is real, not aspirational). Per `plan/VISION.md`'s "Examples" section
and the Phase 6 line in `plan/ROADMAP.md`: every feature ships its
`examples/` entries in the same phase that built it. This is the first
`examples/` directory in the repo — establish the pattern precisely per
VISION.md, since later phases (`examples/providers/`, `examples/
middleware/`, etc.) will follow the same shape.

## Acceptance criteria

Create `examples/core/` with (at minimum) two example subdirectories,
each self-contained and runnable via `bun run` against the local
workspace packages (not published npm versions):

**`examples/core/canonical-event-shape/`** — demonstrates the canonical
event model in use:
- `README.md`: what this example shows, how to run it
  (`bun install && bun run index.ts` or equivalent), prerequisites.
- `index.ts` (or similarly named entry point): a small realistic app using
  `createAnalytics()` with a hand-written `AnalyticsProvider` (or the
  `noop` provider) that logs the full `CanonicalEvent` it receives,
  calling `track("User Signed Up", { plan: "pro" }, { context: { locale:
  "en-US" }, metadata: { source: "web" } })`, `identify(...)`, `group(...)`,
  followed by a second `track()` call, showing `anonymousId`/`sessionId`/
  `userId` populated correctly and `context`/`metadata` passed through.
  Realistic event names only (e.g. `"User Signed Up"`, `"Checkout
  Started"`, `"Purchase Completed"` — never `test`/`foo`/`bar`).
- `expected-output.txt` (or inlined in the README as a fenced code block):
  the literal console output the example produces when run, including the
  actual `CanonicalEvent` shape logged (with an illustrative UUID/timestamp
  called out as "will differ per run").
- An "Explanation" section (README) walking through why each canonical
  field is populated the way it is.
- A "Production notes" section (README): e.g. don't log full events
  containing PII to stdout in production; this example is illustrative.

**`examples/core/provider-switch/`** — demonstrates switching providers by
changing one config line, no application code changes:
- `README.md` with the same required subsections (source, expected output,
  explanation, production notes).
- A single shared "app" module (e.g. `app.ts`) containing realistic
  business logic that calls `track("Checkout Started", ...)`,
  `track("Purchase Completed", ...)`, `identify(...)` — written once,
  parameterized only by which `AnalyticsProvider` gets passed to
  `createAnalytics()`.
- Two (or three) small entry-point files, each identical except for one
  line constructing a different provider — e.g.
  `run-with-noop.ts` (uses `noopProvider` from `typetrack`) and
  `run-with-ga4.ts` (uses `createGA4Provider(...)` from
  `@typetrack/provider-ga4`, pointed at a documented fake/placeholder
  `measurementId`/`apiSecret` — never real credentials), both importing
  and calling the exact same `app.ts` logic.
- Expected output for each entry point shown separately, demonstrating
  identical application-level behavior (same events, same call sequence)
  with only the provider's own internal handling differing (e.g. one logs
  to console, the other would issue Measurement Protocol requests — since
  this is a static example rather than a live demo against real GA4
  infrastructure, document clearly that running `run-with-ga4.ts` as-is
  will attempt real network requests unless pointed at a local stub, and
  show how to point `apiHost` at a local stub server for a safe dry run).
- Explanation section spelling out: "the only line that changed between
  `run-with-noop.ts` and `run-with-ga4.ts` is the provider construction —
  `app.ts` never imports from `@typetrack/provider-ga4` or references any
  GA4-specific concept," directly demonstrating the Golden Rule from
  `plan/VISION.md`.
- Production notes: e.g. real credentials belong in environment variables,
  never hardcoded; swapping providers in a real app means editing exactly
  the one file that constructs `createAnalytics()`.

- `examples/core/README.md` (top-level, one directory up from the two
  above): a short index linking to both examples and briefly stating the
  `examples/` directory's overall purpose/policy (mirroring VISION.md's
  Examples section).
- No example uses `test`/`foo`/`bar`-style placeholder event names.
- Examples are excluded from the package's published `npm` artifact (do
  not add them to any package's `files`/`exports`) and excluded from
  `bun run build:all`/`tsup` build steps — they are documentation/demo
  code, not shipped library code. Confirm this doesn't break `bunx knip`
  (unused-code checks) — either add `examples/` to Knip's ignore config if
  it flags these as unused entry points, or structure them so Knip is
  naturally satisfied; state which approach was taken and why.

## Test requirements

Examples are documentation-first, but per this repo's "both unit and
integration tests" requirement, this issue still needs both:

**Unit tests**: for any example file containing non-trivial pure logic
(e.g. a shared helper in `app.ts` that shapes event payloads), add a
colocated `*.test.ts` asserting that logic in isolation (e.g. "the
checkout payload builder produces the expected properties object"). If
`app.ts` truly contains no logic beyond direct `analytics.track(...)`
calls (i.e. nothing pure to unit test), state explicitly in the commit
why no unit test file exists for that module, and cover the same ground
via the integration test below instead — do not simply skip testing.

**Integration tests**: an integration test (e.g.
`examples/core/canonical-event-shape/index.integration.test.ts` and
`examples/core/provider-switch/app.integration.test.ts`) that actually
imports and runs each example's entry point/app logic end-to-end against
the real (non-mocked) `noopProvider` and a hand-written recording stub
provider (never a live network call to any real vendor — the GA4 example
entry point's integration test must point `apiHost` at a local `Bun.serve()`
stub, not real Google infrastructure), asserting the exact sequence and
shape of `CanonicalEvent`s / calls produced matches what the README's
"expected output" documents. This is what keeps the examples from
silently drifting out of sync with the real `typetrack`/adapter APIs as
future phases evolve them.

## Out of scope

- `examples/providers/`, `examples/middleware/`, `examples/plugins/`, etc.
  — later phases per `plan/ROADMAP.md`; this issue is `examples/core/`
  only.
- A live, real end-to-end demo against actual GA4/PostHog/Segment vendor
  infrastructure with real credentials — all examples must be safely
  runnable without any real vendor account, using local stubs/noop where
  network calls would otherwise occur.
- Publishing `examples/` as part of any npm package's shipped `dist/` —
  explicitly excluded per the acceptance criteria above.
- A CLI/scaffolding tool to generate new examples — just the two example
  directories plus the index README, hand-written.
