# 004 — `flush()`/`destroy()` `AggregateError` contract for multi-provider fan-out

## Context

Depends on issue 003 (multi-provider fan-out plumbing already iterates
`flush`/`destroy` over every provider in the list, using whatever minimal
swallow-and-warn behavior issue 003 landed as an intermediate state). This
issue changes only `flush()`/`destroy()`'s **rejection handling** on the
multi-provider path to the locked design: every provider is still given
the chance to run (never fail-fast), but if any provider's `flush?.()`/
`destroy?.()` rejected, the outer call throws a real `AggregateError`
containing all rejection reasons, after all providers have settled.

Single-provider (bare, non-array) path is **unchanged** from Phase 6 in
this issue too: `flush()` is `await provider.flush?.()` (a rejection
propagates as-is, no `AggregateError` wrapping for a single provider);
`destroy()` is `await provider.flush?.(); await provider.destroy?.()`
(same).

## Design decisions made in this issue (narrow implementation gaps)

- **`destroy()`'s two phases (flush-then-destroy) on the multi-provider
  path**: run the flush phase across all providers first (`Promise.
  allSettled` over every `provider.flush?.()`), then — regardless of
  whether any flush rejected — run the destroy phase across all providers
  (`Promise.allSettled` over every `provider.destroy?.()`). Collect
  rejection reasons from **both** phases into one combined `AggregateError`
  if either phase had any rejection; do not let a flush rejection skip
  that provider's destroy call (teardown must still be attempted even if
  drain failed for a given provider — draining is best-effort, teardown is
  not optional).
- **`AggregateError` message**: a short, static description (e.g.
  `"typetrack: N provider(s) failed during flush()"` /
  `"...during destroy()"`, where `N` is the count of rejections) is
  sufficient — the individual reasons are what callers inspect via
  `.errors`, not the message.
- **No `console.warn` on the multi-provider `flush`/`destroy` path** —
  unlike every other verb, this issue's contract is "throw, don't warn."
  Do not also emit warnings for the same failures the `AggregateError`
  already surfaces (would be redundant/confusing double-reporting).
- **Capability gating does not apply to `flush`/`destroy`** — unchanged
  from Phase 6 (`ProviderCapabilities` has no `flush`/`destroy` field);
  every provider's optional `flush?.()`/`destroy?.()` is called if present,
  skipped (not counted as a failure) if the method is simply absent.

## Acceptance criteria

- Multi-provider `flush()`: `Promise.allSettled` over every provider's
  `flush?.()` (providers lacking the method are skipped, not treated as
  settled-undefined-and-fine vs. counted as failure — they simply have no
  promise to await). If the settled results contain zero rejections,
  `flush()` resolves normally with no error. If one or more rejected,
  `flush()` throws (rejects with) an `AggregateError` wrapping every
  rejection reason, only after every provider's `flush?.()` had the chance
  to settle.
- Multi-provider `destroy()`: run the flush phase as above (collect any
  rejections, do not throw yet), then run `Promise.allSettled` over every
  provider's `destroy?.()` (collect any rejections from this phase too).
  After both phases complete, if the combined rejection list (flush phase
  + destroy phase) is non-empty, throw one `AggregateError` containing all
  of them (flush rejections and destroy rejections both included,
  ordering not prescribed). If empty, resolves normally.
- Single-provider path: fully unchanged from Phase 6 — no
  `AggregateError` involved, a rejection propagates as the original
  error/rejection reason exactly as today.

## Test requirements

Both unit and integration tests are required.

**Unit tests** (extend `src/index.multiProvider.test.ts` from issue 003,
or add `src/index.flushDestroy.test.ts`):

- Multi-provider `flush()`, all providers succeed → resolves, no throw.
- Multi-provider `flush()`, one of three providers' `flush?.()` rejects →
  the other two still had `.flush?.()` called (assert via call-tracking
  stubs), the outer `flush()` call rejects with an `AggregateError` whose
  `.errors` contains exactly the one rejection reason.
- Multi-provider `flush()`, two of three reject → `AggregateError.errors`
  contains both reasons.
- Multi-provider `destroy()`, a provider's `flush?.()` rejects but its
  `destroy?.()` does not: assert that provider's `.destroy?.()` was still
  called (not skipped due to the flush failure), and the final
  `AggregateError.errors` contains the flush rejection.
- Multi-provider `destroy()`, both a `flush?.()` and a (different or same)
  provider's `destroy?.()` reject: `AggregateError.errors` contains both
  reasons (length 2 at minimum across the two phases).
- Multi-provider `destroy()`/`flush()`, no rejections → resolves normally,
  thrown value is never an `AggregateError`.
- Single bare provider whose `flush?.()`/`destroy?.()` rejects: the
  rejection propagates as the original error (not wrapped in
  `AggregateError`) — regression check against Phase 6 behavior.
- `console.warn` is not called by the multi-provider `flush`/`destroy`
  rejection path (spy/mock and assert zero calls attributable to this
  path, distinguishing from any capability warnings unrelated to this
  test's setup).

**Integration tests** (extend
`src/index.multiProvider.integration.test.ts` from issue 003): construct a
realistic 3-provider array where one provider's `flush` and another
provider's `destroy` are configured (via the stub) to reject with
realistic `Error` instances (e.g. simulating a network failure message),
call `destroy()` on the `Analytics` instance, catch the thrown value,
assert it's an `AggregateError` instance (`instanceof AggregateError`)
with both original errors present in `.errors`, and assert every
provider's `flush?.()`/`destroy?.()` was still called exactly once despite
the failures.

## Out of scope

- `examples/providers/` — issue 005.
- Any change to `track`/`page`/`screen`/`identify`/`group`/`alias`/
  `reset`'s swallow-and-warn contract (already correct as of issue 003).
- Retry/backoff on flush/destroy failure — reliability phase, later.
