# 004 — Anonymous mode: suppress `identify()`/`alias()`, `userId` stays permanently unset

## Context

Depends on issue 002 (this issue's gate composes with, but is distinct
from, the consent/enabled gate — see ordering below). "Anonymous mode" is
a construction-time policy: an app that wants every event keyed only by
`anonymousId`, never a personal `userId`, regardless of whether the
application code itself ever calls `identify()`.

## Scope of this issue

- Add `anonymousMode?: boolean` to `CreateAnalyticsOptions<Events>`,
  default `false` (omitted ⇒ zero behavior change from pre-issue-004).
- When `anonymousMode` is `true`:
  - `identify(newUserId, traits)` does not mutate the closure's `userId`
    variable and does not call `entry.provider.identify?.(...)` for any
    provider (single or fan-out) — a complete no-op beyond a one-time
    `console.warn` (see below). `userId` remains `undefined` for the
    entire lifetime of the instance, even if `identify()` is called
    multiple times.
  - `alias(newUserId, previousUserId)` is likewise a complete no-op —
    aliasing exists specifically to merge/rename a personal identity,
    which is exactly what anonymous mode opts out of.
  - `group(groupId, traits)` is **unaffected** — deliberate scope
    decision: a "group" (organization/team/account) is not itself a
    personal identifier the way `userId` is; suppressing it too would be
    over-broad. Document this explicitly in the option's doc comment so
    it isn't assumed to also suppress `group()`.
- One-time warning, mirroring the existing `warnedCapabilities` Set
  pattern in `src/index.ts`: the first time `identify()` is called while
  `anonymousMode` is `true`, emit
  `console.warn('typetrack: anonymousMode is enabled -- identify() call ignored.')`
  (and the analogous message for `alias()`), then never warn again for
  that verb on that instance. Use a small `Set<"identify" | "alias">`
  closure variable, separate from `warnedCapabilities` (different key
  space, different reason).
- Gate ordering within `identify()`/`alias()`: the `anonymousMode` check
  runs **before** issue 002/003's `isTrackingAllowed()` gate (cheapest
  check first — a single boolean read needs no consent-state evaluation).
  Both checks independently produce a no-op; order is observably
  irrelevant to the caller, but pick this order for consistency/cheapness
  and document it so a future reader isn't left guessing.

## Design decisions made in this issue

- **Suppression, not an error.** `identify()`/`alias()` calls in anonymous
  mode resolve normally (no thrown exception, no rejected Promise) — an
  app that unconditionally calls `identify()` after login (e.g. from a
  shared auth hook) shouldn't need an `if (!anonymousMode)` guard
  scattered through application code; that's the entire point of a
  construction-time policy switch.
- **`anonymousMode` is immutable for the instance's lifetime** — no
  runtime toggle method (unlike `enable()`/`disable()`). This is a
  deliberate architectural decision, not deferred scope: apps that need to
  toggle anonymous vs. identified tracking at runtime should construct a
  new `Analytics` instance (calling `destroy()` on the old one first) —
  keeps `userId`'s "permanently unset" guarantee simple and airtight
  rather than needing to reason about what happens to an already-set
  `userId` if the mode flips mid-lifetime.

## Acceptance criteria

- `CreateAnalyticsOptions<Events>.anonymousMode?: boolean`, default
  `false`, documented per the above (including the explicit `group()` is
  unaffected note).
- `anonymousMode: true`: `identify("user-123", { plan: "pro" })` does not
  call any configured provider's `identify` method, and a subsequent
  `track()` call's `CanonicalEvent.userId` is still `undefined`.
- `anonymousMode: true`: `alias("new-id", "old-id")` does not call any
  provider's `alias` method.
- `anonymousMode: true`: `group("org-1", { plan: "enterprise" })` **does**
  call the provider's `group` method normally (unaffected).
- `anonymousMode: true`, multiple `identify()` calls: `console.warn` fires
  exactly once (first call only), not once per call.
- `anonymousMode: false`/omitted: zero behavior change from pre-issue-004
  (regression-tested).
- Works identically for both the single-provider and multi-provider
  fan-out paths (no provider in the fan-out list ever receives
  `identify`/`alias` while `anonymousMode` is `true`).

## Test requirements

**Unit tests**: none new — no standalone pure logic beyond a boolean
branch; covered by integration tests below.

**Integration tests** (`src/index.test.ts`, new `describe` block):

- `identify()`/`alias()` no-op verification (single-provider and
  multi-provider), `userId` staying `undefined` across a subsequent
  `track()`'s `CanonicalEvent`.
- `group()` unaffected verification.
- One-warning-only assertion for repeated `identify()` calls (spy on
  `console.warn`).
- No-`anonymousMode` regression check.

## Out of scope

- Any interaction with consent categories (e.g. an `"identify"` consent
  category that maps to this same suppression) — anonymous mode is a
  separate, simpler, construction-time-only mechanism; an app wanting
  consent-driven identify suppression composes it themselves by only
  calling `identify()` from application code after checking
  `analytics.consent.hasConsent(...)` — typetrack does not auto-derive
  this connection.
- Redacting a `userId`-shaped value that arrives via `properties`/
  `context`/`metadata` instead of the `identify()` call itself — that's
  `piiFilterMiddleware`'s (issue 007) job, not anonymous mode's.
- A runtime toggle for `anonymousMode` — explicitly rejected, see Design
  decisions above.
