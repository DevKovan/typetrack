# 004 — SSR-safety verification: explicit no-browser-globals test coverage

## Context

Depends on issues 001/002 (the new fetch-based adapters this issue's test
suite also exercises). Every browser-global access in this codebase
already goes through `isBrowserEnvironment()` (Phase 9) or an equivalent
try/catch-never-throw guard (Phase 12's storage adapters, Phase 11's
`detectBrowserPrivacySignal`) — this issue does not add new guards, it
adds **explicit, dedicated, phase-13-owned test coverage** proving that
contract holds end-to-end, since the ROADMAP names "SSR-safety
verification" as its own deliverable rather than assuming it's implicitly
covered by scattered per-phase tests. Read `src/context.ts` in full, and
skim how `src/context.test.ts` stubs/deletes browser globals — this
issue's tests reuse that exact technique but at a full end-to-end
`Analytics` instance level, not just for one module in isolation.

"SSR" here means: `typetrack` (core) and its adapters must be importable
and usable in a server-side/non-browser JavaScript environment (Node.js
running a Next.js/Remix/etc. server-rendering pass, a Cloudflare Worker, a
Vercel Edge Function) where `window`/`document`/`navigator`/`localStorage`/
`indexedDB` are either fully absent or must never be touched
unconditionally.

## Scope of this issue

- New `src/ssr-safety.test.ts` (core): a dedicated integration test file
  that, for the duration of its tests, deletes/stubs-absent every
  browser global (`window`, `document`, `navigator`, `localStorage`,
  `indexedDB`, `location`) from `globalThis`, then exercises:
  - `createAnalytics()` with **no** options — construct, then call every
    verb (`track`, `page`, `screen`, `identify`, `group`, `alias`,
    `flush`, `destroy`) once — assert none of them throw.
  - `createAnalytics()` with **every** opt-in browser-touching option
    enabled simultaneously (`context: true` (Phase 9), `plugins: [
    autoPage(), autoClicks(), autoScroll(), autoVisibility(), autoErrors(),
    autoWebVitals(), autoPerformance(), autoUTM()]` (Phase 10),
    `consent: { respectBrowserSignals: true }` (Phase 11),
    `cookieless: false` (Phase 11 — deliberately `false` here, to also
    confirm the *non*-cookieless path doesn't crash by assuming storage
    exists), `reliability: { storage: "auto", flushOnUnload: true }`
    (Phase 12)) — construct, exercise every verb once, call `destroy()` —
    assert none of it throws, and that no plugin/option silently no-ops
    in a way that would mask a real crash (e.g. assert `autoPage`'s setup
    function itself completes without throwing, not just that
    `createAnalytics()` overall didn't throw due to Phase 10's
    swallow-and-warn plugin-teardown convention masking something at
    *setup* time — check whether plugin *setup* failures are also
    swallowed today by reading `src/plugins.ts`; if setup failures do
    propagate, this test's assertions are already sufficient; if Phase 10
    also swallows setup-time failures, add a `console.warn`/error spy
    assertion confirming zero warnings fired, so a real crash can't hide
    behind a swallowed warning).
  - `reliability: { storage: "auto" }`'s resolved adapter, in this
    stubbed-absent environment: assert it resolves to the memory adapter
    (`kind: "memory"`) — confirms Phase 12's `detectBestStorage`'s
    non-browser branch is actually exercised here, not just unit-tested
    in isolation.
- New `packages/provider-posthog/src/ssr-safety.test.ts` and
  `packages/provider-segment/src/ssr-safety.test.ts` (or folded into each
  package's existing test file if that's a better fit — implementor's
  choice): the same browser-global-stubbed-absent environment, exercising
  both that package's SDK-based and fetch-based adapter through a full
  `track`/`identify`/`flush`/`destroy` cycle (with `fetch` itself stubbed
  as a spy, so the tests don't make real network calls) — assert neither
  adapter throws.
- `packages/provider-ga4` already has no browser-global usage (confirmed
  in issue 003's research) — a lighter-touch version of the same test is
  still worth adding here for completeness/regression-locking, but is not
  the primary target of this issue's effort.

## Design decisions made in this issue

- **This issue does not add any new production code** — it is
  test-coverage-only, verifying an invariant established across Phases
  9-12. If a genuine SSR-unsafe code path is discovered while writing
  these tests, fix it as part of this issue (small, targeted fix — do not
  expand into a larger refactor) and note the discovery explicitly in the
  commit message, since finding a real bug here would be a meaningful
  result of this phase.
- **Stub-absent, not just stub-falsy.** Deleting `window`/`navigator`/etc.
  entirely (rather than setting them to `undefined` on an object that
  still exists) is the more faithful simulation of a real edge/Worker
  runtime, where these globals are not merely empty but genuinely do not
  exist on `globalThis` at all — matches how Cloudflare Workers/Vercel
  Edge actually behave (no `window` global whatsoever), which is a
  stricter and more realistic test than Node's own default (where
  `window` is simply never defined, same effective behavior, but the
  distinction matters for how the stub is set up in a test using `bun:
  test`'s global manipulation).

## Acceptance criteria

- Every scenario in the Scope section passes with zero thrown errors and
  (where checked) zero unexpected `console.warn`/`console.error` calls.
- `reliability: { storage: "auto" }` resolves to the memory adapter in
  this environment, verified directly (not just indirectly via "nothing
  threw").
- If a real SSR-unsafe path is found and fixed, the fix is minimal,
  targeted, and called out explicitly in the issue's commit message.
- No pre-existing test anywhere in the monorepo is broken by any fix made
  under this issue (full regression pass required if any production code
  changed).

## Test requirements

This issue *is* test coverage — see Scope above for the exact file
list and scenarios. No additional production-code test requirements
beyond what's already specified.

## Out of scope

- Adding new browser-global guards where none are needed (i.e., don't
  defensively wrap code that this issue's tests prove is already safe).
- Testing against a real Cloudflare Workers/Vercel Edge runtime sandbox
  (no such tooling exists in this repo's dependencies, per BRIEF.md
  decision 5) — this issue's simulated stubbed-absent-globals environment
  is the verification mechanism, not an actual deployed Worker.
- `examples/runtimes/` — issue 005.
