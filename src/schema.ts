import type { z } from "zod";

// The canonical, provider-agnostic shape every tracked/paged/screened event
// is normalized into before it reaches an `AnalyticsProvider`. This is what
// replaces the bare `EventMeta` (`{ timestamp }`) from Phase 0-5: instead of
// providers reinventing identity/session bookkeeping themselves, core builds
// one of these per call and every provider method that ships an event
// receives the full object.
export interface CanonicalEvent {
  name: string;
  properties: Record<string, unknown>;
  timestamp: number;
  anonymousId: string;
  userId?: string;
  sessionId: string;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// Optional per-call `track()` extras that ride alongside the payload but are
// never validated against a `schemas[event]` entry -- only `payload` is ever
// passed to `schema.safeParse()`.
export interface TrackOptions {
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // Phase 12 issue 004: opt-in queue-drain priority, only observable when
  // `reliability` is enabled *and* the event in question actually gets
  // queued (offline, or a failed provider call) -- for the common case
  // (the provider call succeeds immediately), this has no effect at all,
  // since the event never touches the queue. Defaults to `0` when omitted,
  // matching issue 003's pre-this-issue hardcoded behavior. Higher values
  // drain first; ties are broken oldest-first (see issue 002's
  // `peekReady` ordering). A single flat numeric field, not a named-level
  // vocabulary (`"low"`/`"high"`) -- an app can establish its own
  // convention (e.g. "10 for purchase events, 0 for page views").
  priority?: number;
}

// Maps event names to their payload shape. A value of `undefined` marks a
// no-payload event (its second `track()` argument becomes optional).
// Payload shapes must be object-shaped (or `undefined`) so they remain
// assignable to `AnalyticsProvider.track`'s `Record<string, unknown>` param.
export type EventMap = Record<string, Record<string, unknown> | undefined>;

// Resolves the tuple type for `track()`'s trailing arguments for a single
// event's payload type `V`: an optional/required `payload` (depending on
// whether `V` is `undefined`) followed by an always-optional trailing
// `TrackOptions`. Written against a naked type parameter (rather than inline
// against an indexed-access type like `Events[K]`) so that TypeScript
// distributes the conditional over unions -- this is what makes the default,
// fully-permissive `EventMap` (`Record<string, Record<string, unknown> |
// undefined>`) keep `payload` optional, matching Phase 0 behavior, rather
// than collapsing to a single non-distributed "required" branch.
export type TrackArgs<V> = V extends undefined
  ? [payload?: V, options?: TrackOptions]
  : [payload: V, options?: TrackOptions];

// Optional per-event Zod schema map. A partial mapped type -- callers may
// supply a schema for some events only; events without an entry receive no
// runtime validation (issue 001's compile-time-only behavior is preserved
// for them). Each schema's output (`z.infer`) is constrained to match the
// corresponding `Events[K]` payload type, so a hand-written `Events` map
// (issue 001) and a supplied schema can never silently drift apart.
export type SchemaMap<Events extends EventMap> = {
  [K in keyof Events]?: z.ZodType<Events[K]>;
};

// Derives an `Events`-shaped map from a plain object of Zod schemas, so the
// payload shape is declared exactly once (inside the schema) rather than
// hand-duplicated as a separate TS interface. Usage:
//
//   const eventSchemas = {
//     signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
//     page_viewed: z.undefined(),
//   } satisfies Record<string, z.ZodType>;
//
//   type Events = InferEvents<typeof eventSchemas>;
export type InferEvents<S extends Record<string, z.ZodType>> = {
  [K in keyof S]: z.infer<S[K]>;
};

// Thrown synchronously by `track()` when a `schemas[event]` entry exists but
// `payload` fails validation. The provider is never called in this case.
// Carries the event name, the original (unparsed) payload, and the Zod
// validation issues for the caller to inspect/log.
export class EventValidationError extends Error {
  readonly event: string;
  readonly payload: unknown;
  readonly issues: z.ZodIssue[];

  constructor(event: string, payload: unknown, error: z.ZodError) {
    super(`Validation failed for event "${event}": ${error.message}`);
    this.name = "EventValidationError";
    this.event = event;
    this.payload = payload;
    this.issues = error.issues;
  }
}
