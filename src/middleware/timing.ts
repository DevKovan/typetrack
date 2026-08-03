// Built-in `timingMiddleware` (Phase 8 issue 005): an opt-in middleware that
// measures wall-clock time from `before()` to `after()` for each event. It
// is a named export, never auto-registered by `createAnalytics()` -- an app
// must explicitly `.use(timingMiddleware({...}))` to enable it.
//
// Injectable clock: `now` defaults to `Date.now` but can be overridden (e.g.
// with a controlled sequence of return values) so tests can assert exact
// durations deterministically, without depending on real wall-clock time.
//
// `after()`'s contract (this phase's locked `Middleware` shape) is `void` --
// no event-mutation return -- so the elapsed duration cannot be written back
// into the already-dispatched event. Instead it's surfaced via the
// caller-supplied `onTiming(event, durationMs)` callback, invoked from
// `after()`.
//
// Per-event pairing, not a single shared "last start time" variable: start
// times are recorded in a `WeakMap` keyed by the actual `CanonicalEvent`
// object reference seen in `before()`, not a single outer closure variable.
// This is what keeps two concurrent/interleaved `track()` calls (each with
// their own distinct event object) from cross-contaminating each other's
// duration -- there is no shared mutable "current start" state to race on.
//
// Ordering note: `before()`'s own event reference must be the one that
// eventually reaches `after()` unchanged for the pairing to resolve. Any
// *later*-registered middleware that returns a *new* object from its own
// `before()` (e.g. `redactMiddleware`/`enrichmentMiddleware`/
// `versionMiddleware`, all of which shallow-clone via spread) changes the
// reference that ultimately becomes the post-before-chain event. So
// `timingMiddleware` should be registered after any event-transforming
// middleware in the chain (pure observers registered after it, like
// `loggingMiddleware`, are fine either way since they never replace the
// event object) -- this matches the realistic ordering used in this
// middleware's own integration tests.
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";

export interface TimingOptions {
  onTiming: (event: CanonicalEvent, durationMs: number) => void;
  now?: () => number;
}

// Builds the timing middleware. Registers `before` (records the start time
// for this specific event) and `after` (computes the elapsed duration and
// invokes `onTiming`) -- no `onError`, since a failed dispatch still means
// `after()` never runs for this middleware (see `runThroughMiddleware` in
// `src/index.ts`), so there is no meaningful duration to report on failure.
export function timingMiddleware(options: TimingOptions): Middleware {
  const now = options.now ?? Date.now;
  const startTimes = new WeakMap<CanonicalEvent, number>();

  return {
    name: "timing",
    before(event: CanonicalEvent): CanonicalEvent {
      startTimes.set(event, now());
      return event;
    },
    after(event: CanonicalEvent): void {
      const startedAt = startTimes.get(event);
      if (startedAt === undefined) {
        // No matching `before()` recorded for this exact event reference --
        // defensively a no-op rather than reporting a nonsensical duration.
        return;
      }
      startTimes.delete(event);
      options.onTiming(event, now() - startedAt);
    },
  };
}
