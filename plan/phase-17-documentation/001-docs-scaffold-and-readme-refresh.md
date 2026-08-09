# 001 -- `docs/` scaffold, index page, and root `README.md` refresh

## Context

First issue in this phase -- every later issue (002-010) adds a file under
`docs/` that `docs/README.md` (this issue) must link to, and the root
`README.md`'s new `## Documentation` section (this issue) must point at
`docs/README.md`. Read `plan/phase-17-documentation/BRIEF.md`'s Design
decisions 1, 2, and 4 first (the `docs/` layout, and the exact staleness
found in the current root `README.md`).

## Scope of this issue

1. **Create `docs/README.md`** -- a short index page, not a guide itself:
   - One or two sentences restating the Golden Rule (`plan/VISION.md`):
     applications depend only on `typetrack`, never a vendor SDK directly.
   - A linked list of every guide this phase ships, each with a one-line
     description of what it covers and who it's for:
     - `architecture.md` -- how an event flows from `track()` to a
       provider, and why the pieces are split the way they are.
     - `cookbook.md` -- short, task-oriented "how do I..." recipes.
     - `migration.md` -- switching from a direct vendor SDK (or from this
       repo's own pre-Phase-6 shape) to typetrack.
     - `providers/ga4.md`, `providers/posthog.md`, `providers/segment.md`
       -- per-adapter config/capabilities/setup reference.
     - `plugins.md` -- the eight built-in `auto*` plugins.
     - `middleware.md` -- the `use()` chain and the six built-in
       middlewares.
     - `performance.md` -- what's cheap, what's opt-in-cost, how to keep
       the hot path fast.
     - `comparison.md` -- typetrack vs. direct PostHog/Segment/RudderStack
       SDK usage.
     - `faq.md`.
   - This file itself contains no `docs/*`-referencing code samples (it's a
     table of contents) -- issue 011's citation check has nothing to verify
     here beyond the links resolving.
2. **Create the empty `docs/providers/` directory** (via a placeholder file
   if needed for git to track an otherwise-empty directory, e.g. creating
   `docs/providers/ga4.md` itself in this issue is also acceptable -- the
   implementor's choice; issue 005 is the one that actually writes real
   content into the three `docs/providers/*.md` files, so if this issue
   creates them, leave them as a one-line "content coming in issue 005"
   stub that issue 005 replaces outright, not something issue 005 has to
   preserve/merge with).
3. **Refresh root `README.md`**, in place (edit, don't rewrite unrelated
   sections):
   - `## Usage`: replace the pre-Phase-6 two-positional-argument sample
     (`analytics.track("signup_completed", { plan: "pro" })` with a
     hand-written `AnalyticsProvider` showing `track(event, payload, meta)`)
     with the real, current shape. Base the replacement on actually reading
     `src/index.ts`'s exported `Analytics.track` signature and `src/
     providers/index.ts`'s `AnalyticsProvider.track(event: CanonicalEvent)`
     -- the corrected sample must show a provider's `track` receiving one
     `CanonicalEvent` argument, not three positional ones. Keep the sample
     short (this is a README quickstart, not the architecture guide) --
     3-6 lines showing `createAnalytics()` + one `track()` call is enough;
     defer anything deeper to `docs/cookbook.md`'s link.
   - `## Status`: replace "Early scaffold — see `plan/` for the phased
     build-out" with an accurate one-line summary reflecting the real,
     current phase count (read `plan/ROADMAP.md`/`plan/CHANGELOG.md` to
     state the true number of landed phases as of this issue) and a
     pointer to `plan/ROADMAP.md` for what's next.
   - Add a new `## Documentation` section (placed after `## Usage`, before
     `## Building from source` -- the implementor may adjust ordering
     slightly if it reads better, but keep `## Install` first and `##
     Status` last) linking to `docs/README.md` with a one-line description.
   - Do not touch `## Install`/`## Building from source` unless something
     in them is also independently verified stale while doing this issue's
     read (if so, fix it and note the fix in the commit body -- don't leave
     a known inaccuracy in place just because it's outside this issue's
     original list).

## Testing

This is a documentation-only issue -- no unit/integration tests apply. Verify
by hand: every link in `docs/README.md` resolves to a real (even if
stub-content, for `docs/providers/*.md`) file; the root `README.md`'s
refreshed `## Usage` sample is checked against `src/index.ts`/`src/
providers/index.ts`'s real current exported signatures (cite the exact
lines read). Run `bun run lint`, `bun run typecheck`, `bun test`, `bunx
knip` to confirm this Markdown-only change doesn't regress anything (it
shouldn't -- no `.ts`/`.tsx` file is touched -- but confirm rather than
assume, per this repo's standing instruction to run the same checks locally
before every push).

## Out of scope

Real content for `docs/architecture.md` through `docs/faq.md` -- issues
002-010. Cross-link verification across every guide -- issue 011.
