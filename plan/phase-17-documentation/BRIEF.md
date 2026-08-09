# Phase 17 brief: documentation

Read CLAUDE.md, `plan/VISION.md` ("Documentation (target)" + "Examples --
mandatory, per-phase"), and `plan/ROADMAP.md` (Phase 17 section) first. Then
read `plan/phase-16-testing-infrastructure/BRIEF.md` and
`plan/phase-15-validation-hardening/BRIEF.md` (the precedent for this
document's own structure).

Before writing anything, this phase's own planning read the full current
public API surface first-hand (not from descriptions): `src/index.ts`
(`createAnalytics`, all of `CreateAnalyticsOptions`, every verb), `src/
providers/index.ts`, `src/schema.ts`, `src/routing.ts`, `src/middleware.ts`
+ `src/middleware/*.ts` (six built-ins), `src/plugins.ts` + `src/plugins/
*.ts` (eight built-ins), `src/context.ts`, `src/consent.ts`, `src/
deprecation.ts`, `src/reliability/{queue,storage,batch}.ts`, `src/devServer/
*`, `src/cli/*`; `packages/provider-ga4/src/index.ts`, `packages/
provider-posthog/src/{index,fetch,mapping}.ts`, `packages/provider-segment/
src/{index,fetch,mapping}.ts`, `packages/provider-contract-kit/src/
index.ts`; all six Phase 14 framework wrapper packages
(react/next/vue/nuxt/svelte/solid/astro/remix) plus the pre-existing react/
next; and the `examples/` directory tree (core, providers, middleware,
plugins, validation, recipes, advanced, runtimes, frameworks). This phase's
docs describe exactly what's shipped in that read, not what `plan/VISION.md`
envisions for a later phase -- see "A stale-vision correction" below for one
concrete place those two disagree.

This phase builds directly on top of Phases 6-16; do not re-litigate their
design. This phase adds and edits Markdown only, plus one small root
`README.md` refresh -- **no `src/`/`packages/*/src` production code changes
anywhere in this phase.**

## A stale-vision correction

`plan/VISION.md`'s "Core architecture pipeline (target)" line reads:

```
Application → Canonical Event → Validation → Middleware → Context →
Enrichment → Filtering → Sampling → Routing → Provider Mapping →
Provider Adapter → Analytics Provider
```

Verified against `src/index.ts`'s actual `track()` body (the other two
data-carrying verbs, `page()`/`screen()`, follow the same order minus the
schema-validation/deprecation steps, which are `track()`-only): the real,
shipped order is **consent gate → deprecated-event resolution → dev-server
mirror → schema validation → canonical-event construction (context capture
happens here, as part of building the event, not as a separate
post-validation pipeline stage) → middleware `before` chain → dispatch
(routing/sampling/capability-gating/reliability-queue decisions all happen
per-provider, inside `dispatch`, not as one shared "Routing" stage before
Provider Mapping) → provider adapter (event-name/property mapping is
adapter-internal, e.g. `packages/provider-ga4/src/index.ts`'s
`translateEventName`/`translateProperties`, not a distinct pipeline stage
core itself runs) → middleware `after` chain**. "Enrichment"/"Filtering"/
"Sampling" are not fixed pipeline stages at all -- they're middleware
(`enrichmentMiddleware`, any `before()` that drops an event) and per-provider
routing config (`ProviderEntry.sampling`), both opt-in and composable, not a
mandatory linear stage every event passes through. The architecture guide
(issue 002) documents the **real** order, with a short explicit callout of
this divergence from the vision doc's aspirational diagram -- readers need
the shipped behavior, not the roadmap sketch.

## Scope (from plan/ROADMAP.md), mapped to issues

- Architecture guide → issue 002.
- Cookbook (task-oriented how-tos) → issue 003.
- Migration guide (from PostHog/Segment/GA4 direct SDK usage, and from
  pre-Phase-6 `EventMeta`) → issue 004.
- Provider guides (one per adapter package) → issue 005.
- Plugin guide → issue 006.
- Middleware guide → issue 007.
- Performance guide → issue 008.
- Comparison pages (vs PostHog/Segment/RudderStack direct SDKs) → issue 009.
- FAQ → issue 010.
- `docs/` scaffold, index/nav page, and the root `README.md` refresh →
  issue 001 (first, since every later issue links into and out of it).
- Cross-link verification + `plan/CHANGELOG.md` entry → issue 011 (last).

## Design decisions locked for this phase

1. **New top-level `docs/` directory, sibling of `src/`/`packages/`/
   `examples/`/`plan/`.** No `docs/` directory exists yet on `main` (verified
   by listing the repo root). `examples/`'s own directory shape (VISION.md's
   "Examples -- mandatory, per-phase" section) is a closed, enumerated list
   of *runnable, workspace-wired, README'd demonstrations* -- prose guides
   with no runnable app/package of their own are a category error there
   (same reasoning Phase 16 used to place `e2e/` outside `examples/`, see
   that phase's BRIEF.md Design decision 4). `docs/` needs no
   `package.json`/workspace entry -- it's plain Markdown, never `bun
   install`ed or `bun test`ed as a package.
2. **`docs/` layout**, one file per guide except `providers/` (one file per
   adapter package, since GA4/PostHog/Segment each have genuinely different
   config/capabilities/HTTP-vs-SDK variants that don't compress into one
   shared file without losing precision):
   ```
   docs/
     README.md          (issue 001 -- index/nav, one-paragraph summary + link per guide)
     architecture.md     (issue 002)
     cookbook.md          (issue 003)
     migration.md         (issue 004)
     providers/
       ga4.md              (issue 005)
       posthog.md          (issue 005)
       segment.md          (issue 005)
     plugins.md            (issue 006)
     middleware.md         (issue 007)
     performance.md        (issue 008)
     comparison.md         (issue 009)
     faq.md                (issue 010)
   ```
3. **Code-sample accuracy policy: no new automated doc-sample-compilation
   tooling this phase.** Considered adding a script that extracts fenced
   ` ```ts ` blocks from `docs/*.md` and runs them through `tsgo`/`tsc` as a
   new CI step. Rejected: every one of this repo's existing `examples/*`
   subdirectories is *already* a real, `bun install`ed, workspace-wired,
   type-checked-by-the-root-`tsconfig.json`-`include`-glob, tested package
   (see `package.json`'s `workspaces` array and `tsconfig.json`'s
   `include`) -- building a second, parallel, docs-specific
   extract-and-compile harness to re-verify code that's already covered by
   the exact same compiler run would be duplicate tooling for zero new
   coverage, not "minimal dependencies" (VISION.md engineering principle).
   Instead, this phase's own editorial policy, enforced by hand in every
   issue and re-verified in issue 011: **every non-trivial code sample in
   every `docs/*.md` file is either (a) copied verbatim from a real,
   currently-passing file under `src/`, `packages/*/src`, or `examples/**`,
   with an inline comment citing the exact source path (and, where it
   clarifies which lines, the symbol name) it was copied from, or (b) is
   short, clearly-labeled illustrative pseudo-code (e.g. a 2-3 line shape
   sketch, or a fictional third-party API being contrasted against) that
   makes no claim of being copy-pasteable, verified-working typetrack code.**
   A sample that doesn't fit either bucket doesn't ship. Issue 011's
   cross-link-verification pass includes grepping every fenced code block
   citation in every `docs/*.md` file against the cited source path/symbol
   actually existing.
4. **Root `README.md` gets refreshed in issue 001, not deferred.** Read in
   full during this phase's planning: it is currently badly stale --
   `## Usage` shows `analytics.track("signup_completed", { plan: "pro" })`
   (pre-Phase-6 two-positional-argument shape) and a hand-written
   `AnalyticsProvider` example with `track(event, payload, meta)` (the
   actual, current `AnalyticsProvider.track(event: CanonicalEvent)`
   signature takes one canonical-event argument, not three positional
   ones -- see `src/providers/index.ts`), and its `## Status` line still
   reads "Early scaffold — see `plan/` for the phased build-out", inaccurate
   after 16 landed phases. Leaving this file wrong while shipping a whole
   `docs/` tree under it would be actively misleading (it's the very first
   thing anyone opening the repo reads) -- issue 001 fixes `## Usage`'s
   sample to the real, current API shape and `## Status` to reflect the
   real, current phase count, and adds a `## Documentation` section linking
   to `docs/README.md`. This is the one non-`docs/` file this phase touches.
5. **Migration guide's `EventMeta` section is short and clearly historical,
   not a step-by-step runbook.** `typetrack` has never been published to npm
   (`"private": false` but no `plan/CHANGELOG.md`/`ROADMAP.md` entry for
   Phase 21's "npm publish" has landed yet -- verified by reading both
   files), so there is no real installed base of pre-Phase-6 consumers to
   migrate. The task description asks for this section "if relevant";
   issue 004 includes one short subsection (what `EventMeta` was, what
   `CanonicalEvent` replaced it with, why -- citing `plan/phase-6-canonical/
   BRIEF.md` if present, else the Phase 6 `plan/CHANGELOG.md` entry) for
   completeness and historical record, sized proportionally to its real
   relevance -- not padded into a full migration runbook nobody needs yet.
   The guide's real weight is the from-vendor-SDK sections (PostHog/Segment/
   GA4 direct usage → typetrack), which describe a migration path real
   future adopters will actually take.
6. **Comparison pages compare capabilities and integration shape, not
   fabricated benchmark numbers.** Phase 19 ("Performance benchmarking",
   `plan/ROADMAP.md`) explicitly owns "comparison against PostHog/Segment/
   RudderStack" for bundle size/cold start/memory/throughput -- this phase
   does not preempt that work with invented numbers. `docs/comparison.md`
   (issue 009) compares real, verifiable-today properties instead: vendor
   lock-in (one `AnalyticsProvider` swap vs. rewriting every call site),
   canonical event model vs. each vendor's own native shape, type safety
   (compile-time `Events`/`SchemaMap` vs. untyped `track(string, object)`
   calls), multi-provider fan-out support, offline queue/reliability,
   consent/privacy primitives, and framework-wrapper coverage -- each claim
   cited against this repo's own shipped code (a specific file/export), not
   asserted from memory. A short, clearly-labeled "bundle size and other
   performance comparisons: tracked separately, see Phase 19" note points
   readers at where quantitative numbers will eventually live, instead of
   silently omitting the topic or guessing at numbers.
7. **RudderStack has no adapter in this repo** (`packages/` has no
   `provider-rudderstack`) -- `docs/comparison.md`'s RudderStack column is
   necessarily a "what direct RudderStack SDK usage looks like, with no
   typetrack adapter existing yet" comparison, not a "here's typetrack's
   RudderStack adapter" writeup. This is stated explicitly in the doc, not
   silently implied.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-17-documentation/`. **Issue files are
   kept, never deleted** (standing policy -- see `plan/ROADMAP.md` "Policy
   changes").
2. For each issue, in order (001 → 011, respecting the dependency chain --
   001 first since every later doc links into/out of `docs/README.md`; 011
   last since it verifies every other issue's links/citations; 002-010 are
   otherwise independent of each other and can be done in any order, numbered
   for readability): the `implementor` subagent writes/edits the Markdown
   (docs-only issues have no unit/integration tests of their own -- the
   "testing" for this phase is issue 011's citation-verification pass plus
   this repo's standing qa.yml checks, run unchanged since no `src/`/
   `packages/*/src` code changes), the `qa` subagent checks it (verifies
   citations resolve, links resolve, `bun run lint`/`typecheck`/`test`/
   `knip` are unaffected/still green), loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly -- plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

Run the full `.github/workflows/qa.yml` step sequence locally before every
push, exactly as every prior phase has (build:all, size, e2e, lint,
typecheck, typecheck:svelte, test, knip) -- even though this phase changes no
production code, a Markdown-only phase can still regress `knip` (an
unreferenced file knip's own config expects, e.g. if `README.md`'s edit
somehow orphans something -- unlikely but cheap to verify) and costs nothing
extra to re-confirm.

## Branching / landing

Commit straight to `main` for each issue (this phase's diffs are small,
additive Markdown files with no cross-file production-code coordination risk
-- no isolation branch needed, unlike a multi-file code phase). No PR, no
force-push -- if `origin/main` has moved, rebase cleanly on top. Add a
one-line Phase 17 entry to `plan/CHANGELOG.md`, following the existing
format (see the Phase 6-16 entries for current style/length) -- issue 011
owns this.

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on `main` and
`plan/CHANGELOG.md` is updated.

## Out of scope for this whole phase

- Any `src/`/`packages/*/src` production code change.
- A new automated doc-code-sample-compilation CI step -- see Design decision
  3.
- Quantitative performance/bundle-size comparison numbers -- Phase 19, see
  Design decision 6.
- A RudderStack provider adapter -- not asked for by this phase or any
  landed phase; `docs/comparison.md` compares against RudderStack's *direct
  SDK*, same as PostHog/Segment's "direct usage" comparison columns.
- npm-publish-facing polish (keywords, badges, SEO) -- Phase 21, per
  `plan/ROADMAP.md`.
- A VSCode extension, event inspector UI, or generated-from-source API
  reference site (e.g. TypeDoc) -- Phase 18 ("Tooling extras") territory,
  not this phase's hand-written guide set.
