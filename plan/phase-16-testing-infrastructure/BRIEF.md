# Phase 16 brief: testing infrastructure

Read CLAUDE.md, `plan/VISION.md` ("Testing (target)" + "Examples --
mandatory, per-phase"), and `plan/ROADMAP.md` (Phase 16 section) first.
Then read `plan/phase-15-validation-hardening/BRIEF.md` and
`plan/phase-14-framework-wrappers/BRIEF.md` (the precedent for this
document's own structure) and, in full, `packages/provider-ga4/src/*`,
`packages/provider-posthog/src/*`, `packages/provider-segment/src/*` --
the three existing provider-adapter packages (five factories total:
`createGA4Provider`, `createPostHogProvider`/`createPostHogFetchProvider`,
`createSegmentProvider`/`createSegmentFetchProvider`) this phase's shared
contract suite must run against identically. Also read `src/providers/
index.ts` (`AnalyticsProvider`/`ProviderCapabilities`/`noopProvider`) and
`src/index.ts`'s `flushOnUnload`/`pagehide`/`navigator.sendBeacon` wiring
(~lines 991-1152) before issue 006.

This phase builds directly on top of Phases 6-15; do not re-litigate their
design.

## Research grounding (informed the design, not assumed)

Before planning, researched (WebSearch, August 2026) rather than assumed:

- **Snapshot testing**: `bun:test` ships native Jest-style
  `toMatchSnapshot()`/`toMatchInlineSnapshot()` (writes to a `__snapshots__/
  *.snap` directory alongside the test file, `--update-snapshots` to
  refresh) -- confirmed current via Bun's own docs
  (https://bun.com/docs/guides/test/snapshot). No separate snapshot library
  is needed or added -- this matches CLAUDE.md's toolchain list (Bun is
  already the test runner) and the "minimal dependencies" engineering
  principle in VISION.md exactly.
- **Bundle-size checking**: `size-limit` (728k weekly downloads, 6.9k
  stars) is the actively-maintained, dominant tool in this space, well
  ahead of `bundlewatch` (136k downloads, 440 stars) and `bundlesize`
  (unmaintained). Critically, its `@size-limit/file` plugin checks raw
  `dist/` file sizes (gzip or brotli) directly, with **no bundler
  dependency required** -- confirmed via the project's own docs
  (https://github.com/ai/size-limit) -- so it composes cleanly with this
  repo's existing `tsup`-built `dist/` output instead of requiring a
  second bundler (`@size-limit/webpack`/`@size-limit/esbuild`) purely to
  re-bundle what `tsup` already produced. Config lives in a root
  `.size-limit.json` (mirrors this repo's existing `.oxlintrc.json`/
  `knip.json` sibling-dotfile convention), one entry per already-built
  artifact.
- **Playwright + Bun**: Playwright's own test runner (`@playwright/test`,
  a distinct CLI/runner from `bun:test`) is confirmed to run under the Bun
  runtime for authoring/executing `.spec.ts` files (`bunx playwright test`)
  -- Bun does not replace it, and nothing in this repo's existing `bun
  test` config touches it. Confirmed monorepo-specific friction (GitHub
  issue microsoft/playwright#29301): Playwright's own `create-playwright`
  scaffolding script hardcodes `npm` internally regardless of the
  invoking package manager, so this phase creates `e2e/`'s config/files by
  hand rather than running the `create-playwright` generator, sidestepping
  that bug entirely (a strictly better outcome than fighting it).
- **What Playwright should actually exercise here**: this SDK has no
  application UI of its own -- `src/devServer` is a JSON/SSE API with no
  browser page, and the framework-wrapper examples (`examples/frameworks/*`)
  are already exercised via each framework's own official testing-library
  + happy-dom (Phase 14 issue 007), which is a real browser-DOM-shaped
  environment but not an actual browser process. The one genuinely
  browser-only, currently-unverified-in-any-form surface is `src/index.ts`'s
  `flushOnUnload` (~line 991-1152): a real `pagehide` listener +
  `navigator.sendBeacon` call, chosen specifically (per that code's own
  comments) because `beforeunload` blocks bfcache eligibility and `unload`
  is unreliable -- exactly the kind of real-navigation-timing behavior
  happy-dom cannot faithfully simulate (its `sendBeacon`/`pagehide` are
  stand-ins, not the real browser navigation lifecycle). The other
  genuinely-unverified-anywhere surface is the bundled IIFE global build
  (`dist/index.global.js`, the `<script src="https://unpkg.com/typetrack">`
  entry point from `tsup.config.ts`'s third build target) -- nothing in
  this repo today loads that artifact in an actual browser and confirms it
  works. Issue 006 targets exactly these two, not a re-test of
  already-covered framework-wrapper component behavior.

## Scope (from plan/ROADMAP.md), mapped to issues

- **Shared contract test suite run identically against every provider
  adapter** -> issues 001 (`packages/provider-contract-kit`, the pure
  suite) and 002 (wiring it into all five factories, deduplicating the
  overlapping capability/lifecycle assertions that today exist,
  independently and slightly differently worded, in `provider-ga4/src/
  index.test.ts`, `provider-posthog/src/{index,fetch}.test.ts`, and
  `provider-segment/src/{index,fetch}.test.ts` -- see issue 002's exact
  removal list).
- **Playwright/e2e** -> issue 006.
- **Snapshot tests** -> issue 003.
- **Bundle-size/performance tests** -> issue 004 (bundle size) and issue
  005 (a narrow performance regression smoke test -- see Design decision 3
  for why this is deliberately not full benchmarking).

## A stale premise, corrected

This phase's originating task description asserted that `.github/
workflows/qa.yml`'s Build step (`bun run build:all`) "only builds root
`typetrack` + `packages/react` + `packages/next`" and does not build the
six Phase 14 framework packages, and asked this phase to fix that gap.
**Verified false as of the current `main`** (`git log -p -- package.json`,
commits `28f5d68` through `4c3a3db`): Phase 14 itself already extended
`build:all` incrementally, once per package, as each of the six framework
packages landed (`7e2c8d2` Vue, `fbac35e` Nuxt, `d3ea287` Svelte, `40aa07d`
Solid, `1dabb67` Astro, `93abde7` Remix) -- the script committed today
already reads `bun run build && bun install && cd packages/react && ...
&& cd ../next && ... && cd ../vue && ... && cd ../nuxt && ... && cd
../svelte && ... && cd ../solid && ... && cd ../astro && ... && cd
../remix && bun run build`, covering all eight buildable packages in
correct dependency order, and `qa.yml`'s Build step already invokes
exactly that script. The three provider-adapter packages
(`provider-ga4`/`provider-posthog`/`provider-segment`) are correctly
**absent** from `build:all` -- they are `"private": true`, ship no `tsup`
config, and their `package.json` `main`/`types` point straight at
`src/index.ts` (source-only, dev/test packages, never published) -- and
are still fully covered by `qa.yml`'s Lint/Typecheck/Test/knip steps via
each tool's existing repo-wide glob (root `tsconfig.json`'s `"packages/*/
src"` include entry, `knip.json`'s `"packages/*": {}"` wildcard, and
`bun test`'s repo-wide recursive discovery, none of which are
workspaces-array-gated). **No CI-wiring issue in this phase re-fixes
`build:all`/the framework-package build gap -- there is nothing left to
fix.** Issue 007 documents this finding (rather than silently dropping the
task instruction) and focuses `qa.yml` changes on this phase's two
genuinely new steps (size-limit, Playwright).

## Design decisions locked for this phase

1. **The shared contract suite validates the `AnalyticsProvider`
   interface's *shape and lifecycle contract* -- capability flags,
   method-presence invariants, resolve/no-throw guarantees, generic error
   propagation -- not vendor-specific wire-payload content.** This is the
   deliberate scope line: GA4's `client_id`/`transaction_id` mapping,
   PostHog's `$identify`/`$groupidentify` event-name convention, and
   Segment's Basic-Auth header are real, adapter-specific behaviors that
   cannot be asserted identically across vendors without either lying
   about what each vendor's wire format actually is or making the "shared"
   suite so abstract it tests nothing real. What *can* be asserted
   identically, and today is asserted with near-identical wording five
   separate times (see issue 002's exact grep-sourced list): `capabilities`
   has the right shape and every value is the declared type; a capability
   flag of `true` implies the corresponding optional method exists on the
   provider object, and `false`/absent implies it does not; `track()`
   resolves for a healthy transport and rejects for a broken one;
   `flush()`/`reset()`/`destroy()`, where present, resolve without
   throwing; `page()`/`screen()`, where present, accept the empty-string
   name sentinel without throwing. This is the actual duplication this
   phase was asked to eliminate.
2. **The kit takes a test-file-supplied harness, not a raw config
   object -- it never constructs a provider's own transport stub itself.**
   Each adapter's existing test file already owns a working, adapter-
   appropriate way to fabricate a "succeeds" and a "fails" transport (a
   stubbed `globalThis.fetch` for GA4/both fetch-based adapters; a
   hand-written fake client object, per CLAUDE.md's "never `mock.module()`
   a vendor SDK" rule, for the two SDK-based adapters). Reimplementing
   that inside the shared kit would either force one transport strategy
   onto adapters that don't use it, or require the kit to special-case
   every adapter anyway -- defeating the point. So the kit's public surface
   is `runProviderContractTests(harness)`, where `harness` supplies
   `createProvider()` (transport wired to succeed) and
   `createFailingProvider()` (transport wired to fail) factory functions
   plus a `name` label -- each adapter's own contract test file builds the
   harness using whatever transport-stubbing approach that file already
   uses, and the kit only ever calls the two factory functions and asserts
   against the returned `AnalyticsProvider` object. See issue 001 for the
   exact interface.
3. **Performance testing (issue 005) is a narrow regression smoke test,
   not the full benchmarking suite ROADMAP.md assigns to Phase 19.**
   Phase 19 ("Performance benchmarking") explicitly owns "bundle size,
   cold start, memory, throughput, tree-shaking; comparison against
   PostHog/Segment/RudderStack" -- a comparative, multi-dimensional
   benchmarking effort. Phase 16's ROADMAP line bundles "bundle-size/
   performance tests" together under "testing infrastructure", which this
   phase reads as: stand up the *regression-guard* piece now (so a future
   change can't silently 10x the cost of the hot path with nothing
   noticing), and leave comparative benchmarking to Phase 19 where it's
   explicitly scoped. Issue 005 is therefore a small, `bun:test`-only,
   no-new-dependency timing assertion around `createAnalytics()` and
   `track()`'s synchronous dispatch overhead, with a deliberately generous
   threshold (tuned to catch a real order-of-magnitude regression, not CI
   runner jitter) -- not a benchmark harness, not a comparison table, not
   a new `mitata`/`tinybench`-style dependency.
4. **`e2e/` is a new top-level directory, a sibling of `src/`/`packages/`/
   `examples/`/`plan/`, not nested under `examples/`.** `examples/`'s own
   documented directory shape (VISION.md's "Examples -- mandatory,
   per-phase" section) is an enumerated, closed list
   (`core,providers,plugins,middleware,frameworks,runtimes,validation,
   recipes,advanced,playground`) of *user-facing, README'd, "how to use
   typetrack" demonstrations* -- `e2e/`'s Playwright specs are internal
   test infrastructure verifying this repo's own build artifacts, not a
   usage example an app author would read to learn the API, and forcing it
   into that list would be a category error against VISION.md's own
   definition. `e2e/` gets exactly the same workspace/tsconfig-include
   wiring `examples/*` subdirectories already get (added to `package.json`
   `"workspaces"` and `tsconfig.json` `"include"`), just outside that
   specific directory.
5. **Only Chromium is installed/run in CI** (`bunx playwright install
   --with-deps chromium`), not the full Firefox/WebKit matrix. Both of
   issue 006's real targets -- `sendBeacon`/`pagehide` and a `<script>`-tag
   IIFE load -- are standard, non-engine-specific web platform behavior
   with no known Chromium-only/WebKit-only divergence relevant to what's
   being tested; running all three engines would triple CI time for
   verification this phase doesn't need. A future phase can widen the
   matrix if a real cross-engine bug ever surfaces.

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-16-testing-infrastructure/`. **Issue
   files are kept, never deleted** (standing policy -- see
   `plan/ROADMAP.md` "Policy changes").
2. For each issue, in order (001 -> 007, respecting the dependency chain --
   002 depends on 001; 003/004/005/006 are independent of 001/002 and of
   each other; 007 depends on 004 and 006 both existing, and documents the
   issue 002 dedup and the corrected build:all finding): the `implementor`
   subagent implements with unit+integration tests (per-issue, where
   applicable -- 006 is itself the test), the `qa` subagent checks it,
   loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly -- plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-16-testing-infrastructure` for isolation. Once all issues
pass QA: push commits to `origin/main` directly (no PR, no force-push --
if `origin/main` has moved, rebase cleanly on top). Delete the
`phase-16-testing-infrastructure` branch (local, and remote only if pushed
there). Do **not** delete `plan/phase-16-testing-infrastructure/` issue
files. Add a one-line Phase 16 entry to `plan/CHANGELOG.md`, following the
existing format (see the Phase 6-15 entries for current style/length) --
issue 007 owns this.

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Out of scope for this whole phase

- Comparative/multi-dimensional performance benchmarking (bundle size vs.
  PostHog/Segment/RudderStack, cold start, memory, throughput,
  tree-shaking analysis) -- Phase 19, per Design decision 3.
- Re-fixing `build:all`/`qa.yml`'s framework-package build coverage --
  already fixed by Phase 14, see "A stale premise, corrected" above.
- Firefox/WebKit in the Playwright matrix -- see Design decision 5.
- Any change to `src/` production code (this phase is test/tooling-only;
  the only `src/` reads are for understanding `flushOnUnload` ahead of
  issue 006, no `src/` file is modified by this phase).
- A schema-diffing/snapshot-drift *tool* (e.g. auto-generating a
  human-readable schema changelog from snapshot diffs) -- Phase 18
  "Tooling extras" territory; issue 003's snapshots are a regression lock,
  not a new tool.
- Visual regression / screenshot-diff testing -- no current ROADMAP/VISION
  line asks for it, and this SDK ships no UI of its own to screenshot.
