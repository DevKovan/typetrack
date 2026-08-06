# 001 -- `packages/provider-contract-kit`: shared `AnalyticsProvider` contract test suite

## Context

New private package `packages/provider-contract-kit` (`"private": true`,
never published, `main`/`types` pointing at `src/index.ts` -- same shape as
`packages/provider-ga4`/`provider-posthog`/`provider-segment`'s own
`package.json`, which are source-only and never built by `tsup`). Depends
on `typetrack` via `file:../..` (same as every other `packages/*` provider
package -- not `workspace:*`, per CLAUDE.md's rule that only true
`packages/*` sibling-to-sibling deps use `workspace:*`; this is a
sibling-to-*root* dep, same category as `provider-ga4`'s own `typetrack`
dependency). Zero vendor deps beyond `typetrack` itself (type-only import
of `AnalyticsProvider`/`CanonicalEvent`).

This issue is pure library code plus its own unit tests proving the kit's
own assertions behave correctly against a hand-written fake provider --
it does **not** touch `provider-ga4`/`provider-posthog`/`provider-segment`
at all (that's issue 002).

Read `plan/phase-16-testing-infrastructure/BRIEF.md`'s Design decisions 1
and 2 first -- this issue implements them exactly.

## Scope of this issue

`packages/provider-contract-kit/src/index.ts` exports:

```ts
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";

export interface ProviderContractHarness {
  // Label used in this suite's own describe() block, e.g. "GA4",
  // "PostHog (SDK)", "PostHog (fetch)", "Segment (SDK)", "Segment (fetch)".
  name: string;
  // Constructs a fresh AnalyticsProvider whose transport (stubbed fetch,
  // fake SDK client -- whatever the caller's own test file already uses)
  // is wired to succeed. Called once per test that needs a healthy
  // provider -- never reused across tests, so no test can observe another
  // test's call history.
  createProvider(): AnalyticsProvider;
  // Constructs a fresh AnalyticsProvider whose transport is wired so that
  // any call track() makes against it rejects/throws (e.g. a stubbed
  // fetch returning a non-2xx response, or a fake client method that
  // throws). Used only by the "track() rejects when the transport fails"
  // test below.
  createFailingProvider(): AnalyticsProvider;
  // A minimal, valid CanonicalEvent this suite can pass to track()/page()/
  // screen() without triggering any adapter-specific validation/mapping
  // edge case the caller doesn't want exercised here (adapter-specific
  // mapping behavior is each package's own test file's job, not this
  // kit's).
  makeEvent(overrides?: Partial<CanonicalEvent>): CanonicalEvent;
}

export function runProviderContractTests(harness: ProviderContractHarness): void;
```

`runProviderContractTests` calls `describe`/`it`/`expect` from `bun:test`
internally (a runtime `import { describe, expect, it } from "bun:test"` at
the top of this file -- `bun:test` is already a devDependency of the root
workspace, and every `packages/*` workspace member already resolves it the
same way `provider-ga4/src/index.test.ts` etc. do today) and produces one
`describe(harness.name + " (provider contract)", () => { ... })` block
containing (at minimum) these assertions -- exact `it()` wording/grouping
is the implementor's call, as long as every case below is covered:

1. **`capabilities` shape**: `provider.capabilities` is a defined object;
   `identify`/`group`/`alias`/`page`/`screen`/`batching`/`offline`/
   `featureFlags`/`sessionReplay`/`heatmaps` are all present and
   `typeof === "boolean"`; `batch`/`runtimes`, if present, are
   `boolean`/`Array<string>` respectively (both optional per
   `ProviderCapabilities` -- absent is valid, not a failure).
2. **Capability-implies-method invariant, both directions**: for each of
   `identify`/`group`/`alias`/`page`/`screen`, `capabilities.X === true`
   implies `typeof provider.X === "function"`, and `capabilities.X ===
   false` implies `provider.X === undefined`. (`track` is excluded --
   it's non-optional on `AnalyticsProvider` and has no corresponding
   capability flag.)
3. **`provider.name` is a non-empty string.**
4. **`track()` resolves for a healthy transport**: `await
   expect(harness.createProvider().track(harness.makeEvent())).resolves
   .toBeUndefined()` (or equivalent) -- `track()`'s return type is `void |
   Promise<void>`, so this must tolerate a synchronous provider too (wrap
   in `Promise.resolve(...)` before asserting, don't assume every
   adapter's `track()` returns a real Promise).
5. **`track()` rejects for a broken transport**: calling `track()` against
   `harness.createFailingProvider()` either throws synchronously or
   returns a rejected Promise -- assert via a helper that tolerates both
   forms (`Promise.resolve().then(() => provider.track(...))` wrapped in
   `expect(...).rejects.toThrow()`, or equivalent).
6. **`page()`/`screen()` empty-string name sentinel, when implemented**:
   if `capabilities.page`/`capabilities.screen` is `true`, calling
   `provider.page?.(harness.makeEvent({ name: "" }))` /
   `provider.screen?.(...)` does not throw and resolves.
7. **`flush()`/`reset()`/`destroy()`, when present, resolve without
   throwing**: for each of the three, if `provider[method]` is defined,
   calling it does not throw and (for `flush`/`destroy`, both
   `Promise<void>`-returning per the interface) resolves.
8. **Two `track()` calls with different `anonymousId` values on the same
   provider instance both resolve without throwing** (a light,
   provider-agnostic regression guard against any adapter accidentally
   caching/reusing identity state across calls -- every existing adapter's
   own test file already asserts the *specific* translated value differs
   per call; this generic version only asserts neither call throws,
   leaving the value-level assertion to each package's own test).

## Testing

`packages/provider-contract-kit/src/index.test.ts`: proves the kit's own
assertions actually catch violations, using a hand-written fake
`AnalyticsProvider` (no real adapter involved) -- construct one harness
whose fake provider genuinely satisfies every rule above (all assertions
inside `runProviderContractTests` pass), and, in a handful of targeted
sub-tests, deliberately break one rule at a time (e.g. a fake provider
declaring `capabilities.identify: true` but with no `identify` method) and
assert that calling `runProviderContractTests` against that harness throws
during the `bun:test` run (Bun's `describe`/`it`/`expect` calls throw
synchronously on registration/assertion failure inside the same process,
so this can be exercised directly -- if the implementor finds a cleaner
way to prove the kit's own correctness under `bun:test`'s execution model,
that's an acceptable substitution, as long as it demonstrates the kit
actually fails closed, not just that it runs without error against an
already-compliant fake).

## Out of scope

Wiring this kit into `provider-ga4`/`provider-posthog`/`provider-segment`
(issue 002). Any adapter-specific (vendor wire-format) assertion --
this kit is deliberately generic, per BRIEF.md Design decision 1.
