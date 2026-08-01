# 003 — Configurable validation-failure handling (`onValidationError`)

## Context

Depends on: `002-zod-schema-events.md`, which establishes the default behavior (`track()` throws a synchronous `EventValidationError` when a schema-backed event fails validation, and never calls the provider in that case).

Always-throw is a reasonable default for surfacing bugs, but analytics SDKs conventionally must not be able to crash a production host application on every call site. This issue adds an explicit, opt-in override so callers can choose non-throwing handling (e.g. log-and-drop, report-to-error-tracker-and-drop) without wrapping every `track()` call in `try`/`catch`.

## Acceptance criteria

- [ ] `CreateAnalyticsOptions<Events>` gains an optional `onValidationError?: (error: EventValidationError) => void` field.
- [ ] When `onValidationError` is **not** supplied: behavior is unchanged from issue 002 — `track()` throws `EventValidationError` synchronously on a failed validation, and does not call the provider.
- [ ] When `onValidationError` **is** supplied: on a failed validation, `track()` does **not** throw. Instead, `onValidationError(error)` is called with the `EventValidationError`, and `provider.track()` is **not** called (invalid data must never reach the provider, regardless of failure-handling mode).
- [ ] If `onValidationError` itself throws, that exception is allowed to propagate normally out of `track()` (i.e. `typetrack` does not swallow errors thrown by the caller's own handler).
- [ ] `track()`'s return type (`void | Promise<void>`) is unaffected by this issue — `onValidationError` is fire-and-forget from `track()`'s perspective (its return value, if any, is ignored), not awaited as part of the resolved promise chain, unless the implementor finds a compelling reason to await it (if so, document the reasoning in the commit).
- [ ] Successful validations are entirely unaffected by whether `onValidationError` is configured.

## Test requirements

**Unit tests**:
- With `onValidationError` configured: a failing `track()` call does not throw, `onValidationError` is called exactly once with an `EventValidationError` matching the failing event/payload, and the mocked provider's `track` is confirmed not called.
- Without `onValidationError` configured: confirm (regression-guard) the issue-002 throwing behavior still holds.
- A handler that itself throws: confirm the thrown error propagates out of the `track()` call (i.e. is observable by the caller of `track()`, not silently swallowed).

**Integration test**:
- End-to-end scenario with a real test `AnalyticsProvider` and a real Zod schema: configure `onValidationError` to push failures into a local array/log instead of throwing; drive a sequence of `track()` calls mixing valid and invalid payloads across a couple of schema-backed events; assert that only the valid calls reached the provider, all invalid calls were captured via `onValidationError` (in order, with correct event names), and no exception was thrown at any point during the sequence.

## Out of scope

- Any retry/queueing behavior for failed events — out of scope for the whole phase, not just this issue.
- Global/default `onValidationError` configuration outside of `createAnalytics()`'s options (e.g. no module-level or environment-variable-driven default) — must be passed explicitly per `createAnalytics()` call.
- Changing the default (throwing) behavior itself — that's issue 002's decision; this issue only adds the opt-out.
- Applying `onValidationError` to any error other than `EventValidationError` (e.g. this is not a general-purpose error hook for provider failures, network errors, etc.).
