import type { CanonicalEvent } from "../schema";

// Declares which of the optional `AnalyticsProvider` verbs/features a given
// provider actually implements/supports, so core (issue 002) can gate calls
// (warn/no-op) instead of unconditionally invoking a method a real provider
// adapter never wired up.
export interface ProviderCapabilities {
  identify: boolean;
  group: boolean;
  alias: boolean;
  page: boolean;
  screen: boolean;
  // Pre-existing (Phase 6): "this provider does its own internal
  // client-side batching transparently" -- e.g. posthog/segment set this
  // `true` because their own SDK internally batches via
  // flushAt/flushInterval, GA4 sets it `false`. Opaque to core: nothing in
  // `src/` reads this to decide anything -- it's purely descriptive
  // metadata a provider adapter can expose. Not to be confused with
  // `batch` below, which is a distinct, newer (Phase 12 issue 005) opt-in
  // signal that core's own drain loop reads.
  batching: boolean;
  offline: boolean;
  featureFlags: boolean;
  sessionReplay: boolean;
  heatmaps: boolean;
  // Phase 12 issue 005: distinct from `batching` above -- this declares
  // "this provider opts into receiving core's own drain-loop-coalesced
  // `trackBatch(events[])` calls" rather than "this provider batches
  // internally/opaquely on its own". Optional (unlike every other flag on
  // this interface) so no existing provider/test that predates this issue
  // breaks -- a provider that omits it (or a provider whose `capabilities`
  // object was built before this field existed) is treated exactly as
  // `batch: false`/unset: core's drain loop (`drainQueueOnce()` in
  // `src/index.ts`) falls back to its pre-issue-005 one-call-per-entry
  // path for it. Gating requires *both* this being `true` *and*
  // `trackBatch` actually being implemented (mirrors every other
  // capability-flag + optional-method pairing on this interface).
  batch?: boolean;
}

export interface AnalyticsProvider {
  name: string;
  capabilities: ProviderCapabilities;
  init?(config: Record<string, unknown>): void | Promise<void>;
  track(event: CanonicalEvent): void | Promise<void>;
  identify?(userId: string, traits: Record<string, unknown> | undefined, anonymousId: string): void | Promise<void>;
  group?(groupId: string, traits: Record<string, unknown> | undefined, identity: { userId?: string; anonymousId: string }): void | Promise<void>;
  alias?(newUserId: string, previousUserId: string | undefined, anonymousId: string): void | Promise<void>;
  page?(event: CanonicalEvent): void | Promise<void>;
  screen?(event: CanonicalEvent): void | Promise<void>;
  flush?(): Promise<void>;
  reset?(): void | Promise<void>;
  destroy?(): Promise<void>;
  // Phase 12 issue 005: optional. Receives 2+ events destined for
  // `track`/`page`/`screen` (whatever verb each queued entry itself was),
  // in original priority/FIFO drain order -- exclusively an offline-queue
  // (`src/reliability/`) drain-loop optimization, never invoked from the
  // fast `track()`/`page()`/`screen()` path for a single, non-queued
  // event (there is nothing to coalesce when there's only one event and
  // it isn't queued). A provider implementing this opts into receiving
  // queued events in batches instead of one `track`/`page`/`screen` call
  // per event, whenever the drain loop has multiple ready entries for it
  // at once -- gated on `capabilities.batch === true` (see above) in
  // addition to this method actually being present. All-or-nothing
  // contract: the return value carries no per-event status, so a
  // rejection here is treated by the drain loop as every event in that
  // call having failed (see `drainQueueOnce()` in `src/index.ts`).
  trackBatch?(events: CanonicalEvent[]): void | Promise<void>;
}

// `noopProvider`'s entire purpose is to accept every call harmlessly as a
// safe default/test double. It implements every optional method as a
// genuine no-op and declares every capability `true` -- declaring any
// capability `false` would make core's Phase-6 capability-gating (issue 002)
// start silently warning/no-oping calls made against the *intentionally*
// do-nothing provider, which is exactly the opposite of what a no-op default
// should do.
export const noopProvider: AnalyticsProvider = {
  name: "noop",
  capabilities: { identify: true, group: true, alias: true, page: true, screen: true, batching: true, offline: true, featureFlags: true, sessionReplay: true, heatmaps: true },
  track() {},
  identify() {},
  group() {},
  alias() {},
  page() {},
  screen() {},
  async flush() {},
  reset() {},
  async destroy() {},
};
