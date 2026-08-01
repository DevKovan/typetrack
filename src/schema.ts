// Filled in by the core before dispatch; callers never set this directly.
export interface EventMeta {
  timestamp: number;
}

// Maps event names to their payload shape. A value of `undefined` marks a
// no-payload event (its second `track()` argument becomes optional).
// Payload shapes must be object-shaped (or `undefined`) so they remain
// assignable to `AnalyticsProvider.track`'s `Record<string, unknown>` param.
export type EventMap = Record<string, Record<string, unknown> | undefined>;

// Resolves the tuple type for `track()`'s trailing payload argument for a
// single event's payload type `V`. Written against a naked type parameter
// (rather than inline against an indexed-access type like `Events[K]`) so
// that TypeScript distributes the conditional over unions -- this is what
// makes the default, fully-permissive `EventMap` (`Record<string,
// Record<string, unknown> | undefined>`) keep `payload` optional, matching
// Phase 0 behavior, rather than collapsing to a single non-distributed
// "required" branch.
export type TrackArgs<V> = V extends undefined ? [payload?: V] : [payload: V];
