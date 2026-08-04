# Phase 13 brief: runtime-agnostic adapters

Read CLAUDE.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and plan/ROADMAP.md
(Phase 13 section) first. Read `packages/provider-ga4/src/index.ts` in
full — it is this phase's reference implementation for "runtime-agnostic":
zero vendor dependencies, a plain `fetch()` POST to GA4's Measurement
Protocol HTTP endpoint, no Node-specific API usage anywhere. Compare
against `packages/provider-posthog/src/index.ts` (depends on
`posthog-node`) and `packages/provider-segment/src/index.ts` (depends on
`@segment/analytics-node`) — both vendor SDKs are written primarily for
Node.js server environments; neither is guaranteed to work unmodified in
a browser, Cloudflare Worker, or Vercel Edge Function runtime (Node-only
APIs, bundler assumptions, etc. — verify the specifics per-adapter as part
of issues 001/002, don't assume either way without checking the installed
SDK's own source/docs). Also read `src/providers/index.ts` in full
(`AnalyticsProvider`, `ProviderCapabilities`) and `src/context.ts`
(`isBrowserEnvironment`, the try/catch-never-throw convention for
browser-global access this phase's SSR-safety work leans on).

This phase builds directly on top of Phases 6-12; do not re-litigate their
design. Phase 12's reliability queue (`src/reliability/`) is a natural
pairing partner for this phase's fetch-based adapters (a fetch-based
adapter has no SDK-level retry/offline queue of its own — Phase 12's core
queue is exactly what covers that gap) — mention this synergy in
documentation, but this phase does not need to change anything in
`src/reliability/` itself.

## Scope (from plan/ROADMAP.md), mapped to issues

- **PostHog/Segment adapters gain browser/fetch-based variants** → issues
  001, 002. **GA4 needs no change** — already runtime-agnostic, confirmed
  by reading its source above; no issue touches `packages/provider-ga4`.
- **Cloudflare Workers/Vercel Edge/Bun/Deno explicit support** → issue 003
  (truthful, declarative `ProviderCapabilities.runtimes` per adapter) +
  issue 005 (`examples/runtimes/` demonstrating real usage in each).
- **SSR-safety verification** → issue 004.
- **Examples**: `examples/runtimes/` → issue 005.

## Design decisions locked for this phase

No interactive `grill-me` session was available when this plan was
written — these decisions were resolved by directly reading the existing
GA4 adapter (already the exact pattern this phase generalizes to
PostHog/Segment) and this repo's own established precedents (Phase 6's
capability-declaration pattern, Phase 12's `batch`/`trackBatch`
optional-capability-plus-optional-method pairing, the "examples ship with
the phase that builds the feature" policy). If the user disagrees with
any of these before/during implementation, they supersede this document —
flag and resolve via grill-me at that point.

1. **Additive, not a replacement.** `createPostHogProvider`/
   `createSegmentProvider` (the existing Node-SDK-based factories) are
   untouched — they remain the right choice for a Node backend that wants
   the vendor SDK's own batching/offline behavior. New
   `createPostHogFetchProvider`/`createSegmentFetchProvider` factories are
   added alongside them in the same package (same `packages/provider-
   posthog`/`packages/provider-segment` — no new package, since the
   fetch variant is still conceptually "the PostHog adapter," just a
   different transport), zero vendor dependency, usable anywhere `fetch`
   exists (browser, Workers, Edge, Bun, Deno, Node 18+).
2. **Shared event/property-name mapping logic, not duplicated.** Both
   variants within a package must produce identical
   `translateEventName`/`translateProperties` behavior for the same
   config (an app switching from the SDK-based to the fetch-based variant
   should see zero difference in the events actually sent, only in
   transport) — extract the existing mapping logic from each package's
   current `src/index.ts` into a shared internal module (e.g. `src/
   mapping.ts`) both factories import, rather than copy-pasting it into a
   new file.
3. **Fetch-based variants declare `batching: false`, `offline: false`.**
   Unlike the SDK-based variants (which set these `true` because the
   vendor SDK batches/queues internally), a bare `fetch()` call has
   neither — this is the accurate, truthful capability declaration per
   Phase 6's "declared truthfully against the installed SDK" convention,
   now extended to "declared truthfully against the adapter's actual
   transport."
4. **`ProviderCapabilities.runtimes` is new, optional, declarative
   metadata — core never reads or gates on it.** Mirrors `batching`'s
   existing "opaque to core, purely descriptive" status (see
   `src/providers/index.ts`'s own comment on `batching`) — this phase adds
   observability/documentation value for app authors choosing an adapter
   for a given deployment target, not a new core-enforced gate. Optional
   (like `batch` from Phase 12) so no pre-existing provider/test breaks.
5. **No new toolchain dependencies for Cloudflare Workers/Vercel
   Edge/Deno.** Per CLAUDE.md's "toolchain is devDependencies only:
   Bun/tsgo/typescript/oxlint/Knip/tsup" — this phase does not add
   `wrangler`, `vercel`, or a Deno-specific test runner as a dependency
   anywhere in the repo. The Cloudflare Worker/Vercel Edge/Deno entries
   under `examples/runtimes/` are realistic, correct source-code
   snippets with clear README instructions for how a reader would
   actually run/deploy them elsewhere — not wired into this repo's own
   `bun test` suite (only the Bun example is, since Bun is already this
   repo's own toolchain). Document this explicitly in each non-Bun
   example's README rather than silently omitting their tests.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-13-runtime-agnostic/`. **Issue
   files are kept, never deleted** (standing policy — see
   plan/ROADMAP.md "Policy changes").
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-13-runtime-agnostic` for isolation. Once all issues pass
QA: push commits to `origin/main` directly (no PR, no force-push — if
`origin/main` has moved, rebase cleanly on top). Delete the
`phase-13-runtime-agnostic` branch (local, and remote only if pushed
there). Do **not** delete `plan/phase-13-runtime-agnostic/` issue files.
Add a one-line Phase 13 entry to `plan/CHANGELOG.md` following the
existing format (see the Phase 6-12 entries for the current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick
new work. Report back and go idle once this phase's commits are on main
and cleanup is done.

## Out of scope for this whole phase

- Any change to `packages/provider-ga4` — already runtime-agnostic.
- Replacing or deprecating the existing SDK-based
  `createPostHogProvider`/`createSegmentProvider` factories.
- Adding `wrangler`/`vercel`/Deno tooling as a repo dependency.
- Changes to `src/reliability/` (Phase 12) — mentioned as a natural
  pairing in documentation only.
- A generic "runtime detection" utility in core (e.g. `detectRuntime():
  "node" | "browser" | "edge" | ...`) — `ProviderCapabilities.runtimes`
  is a per-adapter declaration an app author reads at config time, not
  something core computes/branches on at runtime.
- CI wiring to actually deploy/run the Cloudflare Worker or Vercel Edge
  examples against real infrastructure.

## Done criteria

Before declaring done, verify from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist 2>/dev/null; rm -rf
packages/*/node_modules 2>/dev/null`, `bun install`, `bun run build:all`,
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip` — all must
pass. Report back: issues completed, the final fetch-based adapter
shapes landed, the researched `runtimes` capability declarations per
adapter (and why), files changed, and clean-checkout verification
results.
