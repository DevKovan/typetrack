# 006 — Generalize `@typetrack/next`'s `AnalyticsPageView` onto `dispatchPageView()`

## Context

Depends on issue 002 (`dispatchPageView`/`PageViewArgs` exported from
`typetrack`'s public barrel). Read `packages/next/src/AnalyticsPageView.tsx`
and `packages/next/src/buildPageViewArgs.ts` in full before starting — this
issue must be **additive/compatible**, not a breaking rewrite of
`@typetrack/next`'s public API (per the brief).

This issue implements the locked design from this phase's grill-me
interview exactly — do not relitigate:

- `AnalyticsPageView` keeps its exact current public shape: a zero-required-props
  `"use client"` component, `<AnalyticsPageView />`, usable inside (a
  descendant of) `AnalyticsProvider`, still internally wrapped in its own
  `<Suspense>` boundary for `useSearchParams()`. **No prop changes, no
  export renames.**
- It keeps its own Next-router-driven navigation detection
  (`usePathname()`/`useSearchParams()` + `useEffect`) — it does **not**
  call the generic `autoPage()` plugin (which uses History-API watching,
  strictly less accurate for a Next App Router app than the router hooks
  it already uses).
- What changes internally: instead of calling `analytics.page(name, props)`
  directly inside the `useEffect`, it calls `dispatchPageView(analytics, {
  name, props })` — the same shared, dedup-aware dispatch helper `autoPage()`
  itself uses internally (issue 002). This is what makes the component a
  genuine thin wrapper reusing real plugin-module code, satisfying the
  brief's "not a parallel/duplicate implementation" requirement, and gets
  a concrete, valuable side effect for free: React Strict Mode's
  double-invoked effects (development only) no longer produce two
  delivered page views for one real navigation.
- `buildPageViewArgs.ts`'s exported `PageViewArgs` interface is replaced
  with a type-only import of the same shape from `typetrack` (`import type
  { PageViewArgs } from "typetrack";`), removing the duplicate local
  declaration — `buildPageViewArgs()`'s own signature/behavior is
  otherwise unchanged.

## Scope of this issue

1. `packages/next/src/buildPageViewArgs.ts`:
   - Replace the locally-declared `export interface PageViewArgs { name:
     string; props?: Record<string, unknown>; }` with `import type {
     PageViewArgs } from "typetrack";` and re-export it (`export type {
     PageViewArgs };`) so existing consumers importing `PageViewArgs` from
     `@typetrack/next` (if any) keep working — check
     `packages/next/src/index.ts`'s current export list for whether
     `PageViewArgs` is part of the package's own public barrel today, and
     preserve whatever is currently exported there.
   - `buildPageViewArgs()`'s function body/signature is otherwise
     unchanged.
2. `packages/next/src/AnalyticsPageView.tsx`:
   - Import `dispatchPageView` from `typetrack` (alongside the existing
     `useAnalytics` import from `@typetrack/react`).
   - In `AnalyticsPageViewTracker`'s `useEffect`, replace `analytics.page(name,
     props);` with `dispatchPageView(analytics, { name, props });`.
   - No other changes to this file — same `Suspense` wrapping, same
     dependency array, same exported `AnalyticsPageView` component shape.
3. Confirm `typetrack` is already a dependency of `packages/next`
   (`package.json` — it is, `file:../..`, used for `AnalyticsProvider`'s
   `Analytics` type today) — no new dependency needed, just a new import
   from the existing package.

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Why not call `autoPage()` directly**: locked in this phase's grill-me
  interview — Next's router hooks are a strictly better navigation signal
  for a Next app than generic History-API patching; `autoPage()` remains
  the right choice only for non-Next browser apps.
- **`dispatchPageView`'s dedup is a bonus, not the primary motivation**:
  the primary motivation for routing through it is genuine code reuse (per
  the brief's explicit requirement); the Strict-Mode-double-invoke
  protection is a welcome, testable side effect, not the issue's main
  point — do not over-index the acceptance criteria/tests on that one
  behavior at the expense of verifying the refactor didn't change normal
  (non-Strict-Mode) behavior at all.

## Acceptance criteria

- `packages/next/src/buildPageViewArgs.ts` no longer declares its own
  `PageViewArgs` interface; imports the type from `typetrack` instead.
  `buildPageViewArgs()`'s existing behavior (verified by its existing test
  file, `buildPageViewArgs.test.ts`) is unchanged — that test file must
  still pass without modification (or with only import-path-irrelevant
  changes, if any are needed at all).
- `AnalyticsPageView.tsx` calls `dispatchPageView` instead of
  `analytics.page` directly; `<AnalyticsPageView />`'s existing public
  behavior (verified by `index.test.tsx`) is unchanged for the normal
  (non-Strict-Mode-double-invoke) case — same `.page()`-equivalent calls
  fire on mount and on each pathname/search change, in the same order,
  with the same computed args.
- A new or extended test demonstrates that two effect invocations with
  identical computed `PageViewArgs` (simulating React Strict Mode's
  double-invoke behavior — e.g. by directly invoking the tracker's
  effect logic twice, or by rendering under `<React.StrictMode>` if the
  existing test setup supports it) result in exactly one delivered page
  view via the analytics instance, not two.
- No changes to `@typetrack/next`'s public exports beyond what's needed to
  preserve `PageViewArgs`'s existing visibility (if it was exported from
  the package's own barrel before this issue, it still is after).
- `packages/next` still builds (`tsup`), typechecks (`tsgo`/`tsc`), and
  passes `oxlint`/`knip` after this change — verify locally before
  considering the issue done (full clean-checkout verification happens at
  the end of the phase, but a package-local check here catches problems
  early).

## Test requirements

- Existing `packages/next/src/buildPageViewArgs.test.ts` and
  `packages/next/src/index.test.tsx` must continue to pass, updated only
  if the `PageViewArgs` import path change requires it.
- New test coverage (in `index.test.tsx` or a new file) for the
  Strict-Mode-double-invoke dedup scenario described above.
- No new unit test is needed for `dispatchPageView` itself — that's
  already covered by issue 002's tests in `src/plugins/autoPage.test.ts`;
  this issue only needs to prove `AnalyticsPageView` correctly delegates
  to it.

## Out of scope

- Any change to `AnalyticsProvider.tsx` or `@typetrack/react`.
- Adding `autoPage()` (or any other Phase 10 plugin) to `@typetrack/next`'s
  own public API — out of scope for this issue.
- `examples/plugins/` — issue 007 (note: `@typetrack/next`'s own
  pre-existing examples, if any, are unaffected — this refactor is
  internal wiring only, `<AnalyticsPageView />`'s usage from an app's
  perspective is unchanged).
