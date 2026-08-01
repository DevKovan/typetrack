import type { z } from "zod";

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
