// Phase 8's middleware vocabulary: a linear (not onion/wrap) transform +
// observation chain that runs over a `CanonicalEvent` before/after it's
// dispatched to providers. Depends on Phase 6's `CanonicalEvent` (`./schema`),
// but is not consumed by `./index.ts`'s verbs yet -- this module is purely
// additive and pure-functional until issue 002 wires it into
// `track`/`page`/`screen`.
import type { CanonicalEvent } from "./schema";

// A single registered middleware. `name` is informational only (error
// messages/debugging) -- there is no dedup by name; multiple `use()` calls
// accumulate in an ordered list regardless of `name` collisions.
//
// OPEN QUESTION (not decided here, flagging for a future issue): if a
// concrete correctness reason to dedup by `name` turns up, that would be a
// contract change -- do not silently start deduping in this module.
export interface Middleware {
  name: string;
  before?(
    event: CanonicalEvent,
  ): CanonicalEvent | null | undefined | Promise<CanonicalEvent | null | undefined>;
  after?(event: CanonicalEvent): void | Promise<void>;
  onError?(
    error: unknown,
    event: CanonicalEvent,
    ctx: { source: "middleware" | "provider"; providerName?: string },
  ): void | Promise<void>;
}

// Result of running every registered middleware's `before()` in order.
// `dropped: true` means some middleware's `before()` returned
// `null`/`undefined` (an empty `middlewares` list is never "dropped" -- there
// was nothing to drop; `event` is returned unchanged in that case).
// `ranMiddlewares` is the list of middlewares whose `before()` actually
// executed for this call, in registration order (used by issue 003 to know
// which middlewares' `onError`/`after` to invoke).
export interface BeforeChainResult {
  event: CanonicalEvent;
  dropped: boolean;
  ranMiddlewares: Middleware[];
}

// Runs `before()` for each middleware in `middlewares` (registration order),
// threading the event through each in turn. Stops immediately (does not call
// later `before()`s) the first time a `before()` returns `null`/`undefined`.
// A middleware without a `before` method is treated as a no-op passthrough --
// it still "ran" and is included in `ranMiddlewares`.
//
// Does NOT catch errors thrown by `before()` (sync throw or rejected
// Promise) -- letting them propagate is deliberate; the caller (issue 003's
// `src/index.ts` wiring) wraps this call and handles `onError` dispatch,
// since only `src/index.ts` has access to `dispatchToProviders`'s existing
// swallow-and-warn conventions and knows which middlewares already ran. Since
// this function returns as soon as it resolves, a caller that needs the
// partial `ranMiddlewares` on a mid-chain throw must catch inside its own
// per-middleware loop (mirroring the loop below) rather than relying on this
// function's return value, which never resolves on the throwing path.
export async function runBeforeChain(
  middlewares: Middleware[],
  event: CanonicalEvent,
): Promise<BeforeChainResult> {
  let current = event;
  const ranMiddlewares: Middleware[] = [];

  for (const middleware of middlewares) {
    ranMiddlewares.push(middleware);

    if (!middleware.before) {
      continue;
    }

    const result = await middleware.before(current);
    if (result === null || result === undefined) {
      return { event: current, dropped: true, ranMiddlewares };
    }
    current = result;
  }

  return { event: current, dropped: false, ranMiddlewares };
}

// Runs `after()` for each middleware in `middlewares` (registration order,
// NOT reversed), passing the same `event` reference to each -- `after` is
// not a transform stage, so the event is never re-threaded between calls.
// Middlewares without an `after` method are skipped. Like `runBeforeChain`,
// does not catch errors -- propagates them to the caller (issue 003) for
// `onError` handling.
export async function runAfterChain(middlewares: Middleware[], event: CanonicalEvent): Promise<void> {
  for (const middleware of middlewares) {
    if (!middleware.after) {
      continue;
    }
    await middleware.after(event);
  }
}
