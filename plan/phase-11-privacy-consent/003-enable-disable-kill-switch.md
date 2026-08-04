# 003 — `enable()`/`disable()`/`isEnabled()`: the coarse kill switch

## Context

Depends on issue 002 (the shared `isTrackingAllowed()` gate helper this
issue extends). Fills the reserved `Analytics` interface slot called out
by the pre-existing Phase 6 comment in `src/index.ts` ("`enable()`/
`disable()` (privacy/consent gating) are intentionally not part of this
interface yet -- deferred to the Privacy/consent phase") and the VISION.md
verb list (`enable()`, `disable()` are among the 11 canonical verbs).

## Scope of this issue

- Add `enable(): void`, `disable(): void`, `isEnabled(): boolean` to the
  `Analytics` interface. `isEnabled()` is an addition beyond the two
  VISION.md-named verbs, justified for testability/DX symmetry with
  `consent.hasConsent()` — not a re-litigation of VISION.md, purely
  additive.
- Internal closure state: `let enabled = true;` (default matches
  pre-Phase-11 behavior exactly — every existing test continues to pass
  unmodified).
- `enable()` sets `enabled = true`; `disable()` sets `enabled = false`;
  `isEnabled()` returns the current value.
- Extend issue 002's `isTrackingAllowed()` (do not duplicate the check
  elsewhere):
  ```ts
  function isTrackingAllowed(): boolean {
    return enabled && isConsentedForCategories(consentState, requiredCategories, defaultState);
  }
  ```
  `enabled` is checked first (cheapest — a single boolean read) so a
  disabled instance never even evaluates the consent-category logic.
- `reset()`/`destroy()` must **not** alter `enabled` — an explicit
  `disable()` stays disabled across a `reset()` (design decision 1,
  BRIEF.md); `destroy()` doesn't need to touch it either since the
  instance's usable life is ending anyway, but leave the flag as-is rather
  than special-casing it in `destroy()`.

## Design decisions made in this issue

- **`enabled` and consent state are fully independent switches, evaluated
  with AND semantics.** `disable()` is an operational pause (e.g. a
  maintenance window, a feature flag), not a legal-consent primitive —
  conflating the two would make `disable()`'s effect on stored consent
  state ambiguous, which this issue avoids entirely by keeping them
  orthogonal.
- **No capability/warning noise on a disabled instance.** Unlike the
  capability-gating pattern (`isCapabilitySupported`'s one-warning-per-
  provider-per-capability), a disabled instance's blocked calls produce no
  `console.warn` at all — this is expected, deliberate, high-frequency
  behavior (e.g. every `track()` call while paused), not a misconfiguration
  worth flagging.

## Acceptance criteria

- `Analytics.enable()`, `.disable()`, `.isEnabled()` present; `isEnabled()`
  is `true` immediately after construction with no other calls.
- `disable()` blocks all six data verbs (`track`/`page`/`screen`/
  `identify`/`group`/`alias`) completely — no provider call, and for
  `track()`, no dev-server mirror either — exactly like issue 002's
  consent-denied path, verified independent of any `consent` option being
  configured at all (`disable()` alone, with no `consent` option supplied,
  still fully blocks).
- `enable()` after `disable()` restores normal behavior.
- `disable()` combined with a granted consent state (both gates would
  independently pass/fail) — verify the AND composition: disabled +
  consent-granted still blocks; enabled + consent-denied still blocks;
  only enabled + consent-granted (or no consent option) lets calls
  through.
- `reset()` does not re-enable a disabled instance, nor disable an enabled
  one.
- No calls to `enable()`/`disable()` at all: zero behavior change from
  pre-issue-003 (regression-tested).

## Test requirements

**Unit tests**: none new — this is closure-state wiring with no standalone
pure logic; covered by integration tests below.

**Integration tests** (`src/index.test.ts`, extending issue 002's
`describe` block or a new sibling one):

- `disable()`/`enable()` toggle behavior for each of the six verbs.
- The four-way AND-composition matrix (enabled×granted, enabled×denied,
  disabled×granted, disabled×denied) using a stub provider spy.
- `reset()` non-interaction with `enabled`.
- No-`enable`/`disable`-calls regression check.

## Out of scope

- Anonymous mode — issue 004.
- Per-provider consent gating — issue 005.
- Cookieless mode — issue 006.
- Any UI/CMP-facing surface for toggling `enabled` — this issue is the SDK
  primitive only; wiring it to a real cookie banner is application code
  (see issue 008's example).
