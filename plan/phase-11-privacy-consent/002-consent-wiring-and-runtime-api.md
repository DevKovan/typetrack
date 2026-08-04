# 002 — Wire `consent` into `createAnalytics()`, `analytics.consent` runtime API, global gate on the six data verbs

## Context

Depends on issue 001 (`src/consent.ts`'s pure types/logic, not yet
consumed anywhere). This issue wires that module into `src/index.ts`:
construction-time state, the `analytics.consent` runtime surface, and the
global consent gate applied to `track`/`page`/`screen`/`identify`/`group`/
`alias` (the six data-carrying verbs — `flush`/`reset`/`destroy`/`use` are
unaffected, per design decision 1 in `BRIEF.md`).

## Scope of this issue

- Add `consent?: ConsentOptions` to `CreateAnalyticsOptions<Events>`,
  documented: omitted entirely ⇒ zero behavior change from pre-Phase-11
  (no gating performed, `analytics.consent`'s grant/deny/get still work
  and track state, but nothing is ever blocked by them since there's no
  `requiredCategories` to check against).
- Add a `ConsentController` interface and `consent: ConsentController`
  (always present, non-optional) to the `Analytics` interface:
  ```ts
  export interface ConsentController {
    grant(...categories: ConsentCategory[]): void;
    deny(...categories: ConsentCategory[]): void;
    hasConsent(category: ConsentCategory): boolean;
    get(): ConsentState;
  }
  ```
  - `grant()`/`deny()` with zero arguments is a no-op.
  - `get()` returns a shallow-cloned snapshot (`{ ...consentState }`), not
    a live reference — mutating the returned object must never affect
    internal state.
  - `hasConsent(category)` delegates to issue 001's `hasConsent(consentState, category, defaultState)`.
- Construction-time state (closure variables in `createAnalytics()`,
  mirroring how `anonymousId`/`sessionId`/`userId` are already handled):
  - `const defaultState = options.consent ? resolveDefaultState(options.consent) : "denied";`
    (the `"denied"` fallback here is inert/unreachable in practice since
    the gate below is skipped entirely when `options.consent` is
    `undefined` — kept only so the closure variable always has a value).
  - `const consentState: ConsentState = { ...(options.consent?.initialState ?? {}) };`
    — a genuinely mutable object, reassigned-in-place (not replaced) by
    `grant()`/`deny()`.
  - `const requiredCategories = options.consent?.requiredCategories;`
- Internal gate helper (name it `isTrackingAllowed()` — issue 003 extends
  this same function, do not duplicate the check inline at each of the six
  call sites):
  ```ts
  function isTrackingAllowed(): boolean {
    return isConsentedForCategories(consentState, requiredCategories, defaultState);
  }
  ```
- Apply the gate as the **very first statement** in `track()`, `page()`,
  `screen()`, `identify()`, `group()`, `alias()` — before anything else,
  including `track()`'s existing dev-server-mirror `fetch()` call. If
  `!isTrackingAllowed()`, return `undefined` immediately, synchronously —
  no provider call, no middleware run, no dev-server mirror, no schema
  validation. This is a documented, deliberate behavior change to
  `track()`'s previously-unconditional dev-server mirror timing (update
  that function's existing doc comment to reflect the new precondition).
- `reset()` must **not** touch `consentState`/`defaultState`/
  `requiredCategories` — identity/session reset is independent of consent
  state (design decision 1, BRIEF.md).

## Design decisions made in this issue

- **Gate placement is a single shared check, not per-verb duplicated
  logic.** All six verbs call the same `isTrackingAllowed()` closure
  function so issue 003's extension (adding the `enabled` check) touches
  one place, not six.
- **`consent` is always present on `Analytics`, independent of whether the
  `consent` construction option was supplied.** An app can call
  `analytics.consent.grant("analytics")` even if it never configured
  `requiredCategories` — the grant is recorded (visible via `.get()`/
  `.hasConsent()`) but has no gating effect on its own; issue 005's
  per-provider `requiresConsent` can still reference it.
- **`get()` snapshot semantics**: chosen specifically so a caller storing
  the return value (e.g. to persist it in their own CMP) can't
  accidentally corrupt internal state by mutating the object they were
  handed.

## Acceptance criteria

- `CreateAnalyticsOptions<Events>.consent?: ConsentOptions` present and
  documented per the above.
- `Analytics.consent: ConsentController` present, non-optional, and its
  four methods work as specified — verified without any `requiredCategories`
  configured (no gating effect) and with `requiredCategories` configured
  (gating effect, see below).
- No `consent` option supplied at all: `track()`/`page()`/`screen()`/
  `identify()`/`group()`/`alias()` behave byte-for-byte identically to
  pre-Phase-11 (including `track()`'s dev-server mirror still firing
  unconditionally) — regression-tested explicitly.
- `consent: { requiredCategories: ["analytics"] }` (no `initialState`, no
  `defaultState` override ⇒ resolves to `"denied"`): every one of the six
  verbs is a complete no-op (no provider call, and for `track()`
  specifically, no dev-server-mirror fetch either) until
  `analytics.consent.grant("analytics")` is called, after which the same
  calls reach the provider normally.
- `analytics.consent.deny("analytics")` after a prior `grant("analytics")`
  re-blocks the six verbs again.
- `consent: { requiredCategories: ["analytics"], initialState: { analytics: "granted" } }`:
  the six verbs work immediately at construction, no `grant()` call
  needed.
- `consent: { requiredCategories: ["analytics", "marketing"], initialState: { analytics: "granted" } }`:
  still fully blocked (only one of two required categories granted) until
  `marketing` is also granted.
- `analytics.consent.get()`'s returned object, when mutated by the caller,
  has no effect on subsequent `hasConsent()`/gating behavior.
- `reset()` does not clear or otherwise alter consent state — a call
  sequence of grant → `reset()` → verb-call still succeeds (or still
  blocks, for a denied category) exactly as before `reset()`.
- `respectBrowserSignals: true` with a stubbed browser privacy signal
  present, no `initialState`, `requiredCategories: ["analytics"]`: the six
  verbs are blocked by default (fail-closed) even without any explicit
  `defaultState: "denied"` in the config — confirms `resolveDefaultState`
  (issue 001) is actually consumed here, not just defined.

## Test requirements

Both unit and integration tests are required.

**Unit tests**: none new beyond issue 001's `src/consent.test.ts` — this
issue is wiring, not new pure logic; cover it via integration tests below.

**Integration tests** (folded into `src/index.test.ts`, a new `describe`
block, mirroring how Phase 9's context wiring was tested):

- No-`consent`-option regression check (byte-for-byte unchanged, including
  dev-server-mirror timing — assert via a stub `fetch`/dev server double).
- Blocked-until-granted flow for `track`/`page`/`screen`/`identify`/
  `group`/`alias` individually (assert via a spy stub `AnalyticsProvider`
  that no method is called while blocked, and is called once unblocked).
- `initialState` pre-seeding, multi-category AND semantics,
  `respectBrowserSignals` fail-closed behavior (stubbed signal), `get()`
  snapshot immutability, `reset()` non-interaction with consent state —
  each as its own test case.

## Out of scope

- `enable()`/`disable()` — issue 003.
- Anonymous mode — issue 004.
- `ProviderEntry.requiresConsent` / per-provider gating (this issue's gate
  is global-only, applied identically regardless of which/how many
  providers are configured) — issue 005.
- Cookieless mode — issue 006.
- `piiFilterMiddleware` — issue 007.
- `examples/` — issue 008.
