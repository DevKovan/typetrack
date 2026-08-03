// Built-in `samplingMiddleware` (Phase 8 issue 004): an opt-in middleware
// that globally drops a deterministic fraction of events, pre-dispatch,
// before any provider/routing evaluation runs at all. It is a named export,
// never auto-registered by `createAnalytics()` -- an app must explicitly
// `.use(samplingMiddleware({...}))` to enable it.
//
// Two-layer distinction (read this before reaching for `ProviderEntry
// .sampling` -- see `src/routing.ts` -- instead, or alongside, this
// middleware):
//
// - `samplingMiddleware` (this file) is a **global, pre-dispatch,
//   one-time-per-event** gate. It runs inside the `before()` chain, which
//   means the drop decision is made once, before `dispatch()` even begins
//   evaluating routing/capability gating for *any* provider. If this
//   middleware drops an event, no provider in the list -- regardless of its
//   own `include`/`exclude`/`predicate`/`sampling` -- ever sees it.
// - `ProviderEntry.sampling` (Phase 7, `src/routing.ts`'s
//   `shouldRouteToProvider`) is a **per-provider** gate, evaluated later,
//   once per provider, only for events that already survived this
//   middleware (and every other `before()` in the chain). An event that
//   passes `samplingMiddleware` can still be excluded from one specific
//   provider by that provider's own `ProviderEntry.sampling`, while being
//   delivered to every other provider in the same list.
//
// The two are independent and composable: use `samplingMiddleware` to
// reduce overall event volume before it fans out to *any* destination
// (cheaper -- skips routing/middleware `after()`/provider calls entirely for
// dropped events), and `ProviderEntry.sampling` to additionally thin out
// what a specific, possibly expensive/rate-limited provider receives from
// whatever volume survives the global gate.
//
// Both layers key on `event.anonymousId` and reuse the exact same
// `hashToUnitInterval`/`isSampledIn` hash from `src/routing.ts` (imported
// directly, never reimplemented here), so a given anonymousId's in/out
// decision is consistent -- for the same `rate` -- regardless of which
// layer evaluates it.
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";
import { isSampledIn } from "../routing";

export interface SamplingOptions {
  // Fraction of events to keep, in [0, 1]. `0` drops every event; `1` keeps
  // every event. Not clamped/validated here -- an out-of-range value is
  // passed straight through to `isSampledIn`, matching `ProviderEntry
  // .sampling`'s existing (unvalidated) contract in `src/routing.ts`.
  rate: number;
}

// Builds the sampling middleware. Runs in `before()` only: the decision to
// keep/drop is made exactly once, before dispatch, so there's nothing left
// to observe/react to in `after()`/`onError()` for this middleware itself.
export function samplingMiddleware(options: SamplingOptions): Middleware {
  return {
    name: "sampling",
    before(event: CanonicalEvent): CanonicalEvent | undefined {
      return isSampledIn(event.anonymousId, options.rate) ? event : undefined;
    },
  };
}
