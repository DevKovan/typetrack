# Issue 002: Flaky-test triage — happy-dom register/unregister rerun guard

## Why

This phase's task explicitly asks for flaky-test triage: run the full
suite multiple times locally (`bun test --rerun-each` or repeated runs)
to find flaky tests, then fix or document them.

## What was found

Baseline (freshly-installed, freshly-built worktree, exactly what `qa.yml`
does): `bun run test` — 1348 pass, 0 fail. Run three independent times
back to back (fresh process each time, no flags) to check for genuine
cross-run flakiness: **1348/1348 pass, all three times.** No flakiness in
the actual CI invocation.

`bun test --conditions=browser --path-ignore-patterns='e2e/**'
--path-ignore-patterns='benchmarks/tests/**' --rerun-each=5` (Bun's
built-in repeated-run flag): 6588 pass, 152 fail, 44 errors ("Unhandled
error between tests") out of 6740 total test executions.

Root cause, traced to one pattern repeated across 9 files:

- `packages/{react,next,remix,svelte,vue,solid,astro,nuxt}/src/**/
  testSetup.ts` each call `GlobalRegistrator.register()` (happy-dom) at
  **module top level** — required, per each file's own header comment,
  because `vue`/`svelte`/`solid`/etc. must be imported *after* DOM
  globals are registered (an ESM-ordering hazard those comments already
  document, not new).
- The corresponding test file in each package pairs this with
  `afterAll(() => GlobalRegistrator.unregister())`.
- `bun test --rerun-each=N` re-invokes a test file's hooks and `it()`
  blocks N times, but does **not** re-evaluate the file's top-level
  module code. So `register()` fires once (on the file's first, only,
  module evaluation); `unregister()` fires once per rerun. Rerun #2's
  `afterAll` throws `GlobalRegistrator`'s own guard error
  (`"Failed to unregister. Happy DOM has not previously been globally
  registered."`), which Bun reports as an "Unhandled error between
  tests" — and, worse, that crash means reruns #2-5 never had DOM
  globals re-registered either, so every DOM-touching assertion in those
  reruns separately fails with `"document is not defined"`.
- `src/index.global.integration.test.ts` was the one exception: its
  `register()`/`unregister()` calls are both scoped inside the same
  `it()`, wrapped in `try`/`finally` — symmetric per invocation, so it
  was already rerun-each-safe.

## Fix applied

Guarded every `GlobalRegistrator.unregister()` call site with
`GlobalRegistrator.isRegistered` (a public static getter the library
already exposes — confirmed by reading
`node_modules/.bun/@happy-dom+global-registrator*/lib/GlobalRegistrator.js`)
so a second/subsequent call is a no-op instead of a throw:

```ts
afterAll(() => {
  if (GlobalRegistrator.isRegistered) {
    GlobalRegistrator.unregister();
  }
});
```

Applied to all 9 call sites:

- `packages/react/src/AnalyticsProvider.test.tsx`
- `packages/next/src/index.test.tsx`
- `packages/remix/src/index.test.tsx`
- `packages/svelte/src/AnalyticsProvider.test.ts`
- `packages/vue/src/useAnalytics.test.ts`
- `packages/solid/src/AnalyticsProvider.test.ts`
- `packages/astro/src/buildPageLoadScript.test.ts`
- `packages/nuxt/src/runtime/installTypetrackPlugin.test.ts`
- `src/index.global.integration.test.ts` (already safe; guarded anyway
  for consistency — every call site in the repo now shares the same
  defensive shape)

## What the fix does and does not solve

**Solves**: the crash. Re-running `--rerun-each=5` after the fix: 152
fail (unchanged — see below), but only **12** "Unhandled error between
tests" (down from 44), and none of the remaining 12 are the
register/unregister throw — `grep` confirms zero occurrences of "has not
previously been globally registered" / "not previously been globally
registered" in the post-fix run. The remaining 12 are all in
`examples/frameworks/{vue,svelte,solid}` — a different location, same
root-cause family (see "Explicitly not fixed" below).

**Does not solve**: DOM-dependent assertions on reruns #2+ (the
`packages/*` fail count is unchanged at ~140 of the 152 — these are
`"document is not defined"` failures on reruns where `register()` never
re-fires). This is a structural consequence of the ESM-ordering
constraint (Design decision 2 in this phase's BRIEF.md): `register()`
must run before `vue`/`svelte`/etc. are imported, imports resolve at
file-parse time, and no hook — including a first-in-file `beforeAll`,
which *does* re-run under `--rerun-each` — runs before a file's own
imports are resolved. Fully solving this would need restructuring how
these 9 packages load their framework dependencies relative to DOM
registration, which is a testing-infrastructure design change outside
this issue's triage scope. Since real CI (`bun run test`, no
`--rerun-each`) is unaffected (0 fail, verified 3x — see "What was
found" above), this is a documented, accepted limitation of the
`--rerun-each` stress-testing tool, not a production/CI flakiness fix
left undone.

## Explicitly not fixed

`examples/frameworks/{vue,svelte,solid}` hit the identical symptom under
`--rerun-each` (their own `testSetup.ts` files follow the same
module-top-level-register pattern). Not touched this issue: same
structural cause as above, same non-fix would apply (a guard, not a
cure), and normal CI doesn't exercise `--rerun-each` there either. Left
as a documented finding, not silently dropped.

## Deliverable

The 9-file guard fix (this issue), plus a "Flaky-test triage" section in
the `CONTRIBUTING.md` issue 001 creates, recording: the method used
(`bun test --rerun-each=N`), the root cause, the fix, the residual
`examples/frameworks/*` limitation, and the 3x-clean-run evidence that
real CI is not affected.

## Acceptance criteria

- [x] All 9 `GlobalRegistrator.unregister()` call sites guarded with
      `isRegistered`.
- [x] `bun run test` (no flags — the actual `qa.yml` invocation): 0 fail,
      confirmed unaffected by the change.
- [x] `bun test --rerun-each=5`: zero "has not previously been globally
      registered" crashes post-fix (was 8+ pre-fix, one per affected
      file); "Unhandled error between tests" count drops from 44 to 12,
      with the remaining 12 fully attributed to
      `examples/frameworks/{vue,svelte,solid}`, not the 9 fixed files.
- [x] `CONTRIBUTING.md` (issue 001's file) has a "Flaky-test triage"
      section documenting the above, including the explicit statement
      that `examples/frameworks/*` was left unfixed and why.
