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
//
// `threw`/`error` (issue 003): if some middleware's `before()` threw
// synchronously or its returned Promise rejected, the chain stops exactly
// like a drop (no later `before()`s run), but this is reported as `threw:
// true` with `error` set to the caught value, NOT as `dropped: true` -- a
// throw is a distinct outcome from a deliberate drop (issue 003's `onError`
// wiring in `src/index.ts` uses this discriminant to decide whether to
// invoke `onError`). When `threw` is true, `event` is the event that was fed
// into the throwing middleware (i.e. the last successfully-transformed
// event before the failure), and `dropped` is `false` (not applicable).
// `ranMiddlewares` still includes the throwing middleware itself (pushed
// before its `before()` is invoked), matching the "notify the throwing
// middleware and everyone before it" fan-out rule.
export interface BeforeChainResult {
  event: CanonicalEvent;
  dropped: boolean;
  ranMiddlewares: Middleware[];
  threw: boolean;
  error?: unknown;
}

// Runs `before()` for each middleware in `middlewares` (registration order),
// threading the event through each in turn. Stops immediately (does not call
// later `before()`s) the first time a `before()` returns `null`/`undefined`.
// A middleware without a `before` method is treated as a no-op passthrough --
// it still "ran" and is included in `ranMiddlewares`.
//
// Catches errors thrown by `before()` (sync throw or rejected Promise, issue
// 003) rather than letting them propagate as a rejected Promise -- this lets
// the caller (`src/index.ts`) always get back a resolved `BeforeChainResult`
// with the partial `ranMiddlewares` intact, rather than needing to duplicate
// this loop itself just to recover that list on the throwing path.
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

    let result: CanonicalEvent | null | undefined;
    try {
      result = await middleware.before(current);
    } catch (error) {
      return { event: current, dropped: false, ranMiddlewares, threw: true, error };
    }
    if (result === null || result === undefined) {
      return { event: current, dropped: true, ranMiddlewares, threw: false };
    }
    current = result;
  }

  return { event: current, dropped: false, ranMiddlewares, threw: false };
}

// Result of running every registered middleware's `after()` in order.
// `ranMiddlewares` is every middleware processed (in registration order) up
// to and including the one whose `after()` threw, if any -- mirrors
// `BeforeChainResult.ranMiddlewares`'s "throwing middleware + everyone
// before it" semantics, for the identical short-circuit contract described
// in issue 003.
export interface AfterChainResult {
  ranMiddlewares: Middleware[];
  threw: boolean;
  error?: unknown;
}

// Runs `after()` for each middleware in `middlewares` (registration order,
// NOT reversed), passing the same `event` reference to each -- `after` is
// not a transform stage, so the event is never re-threaded between calls.
// Middlewares without an `after` method are skipped. Like `runBeforeChain`
// (issue 003), catches a throwing/rejecting `after()` and stops the chain
// (later `after()`s do not run), reporting it via `threw`/`error` instead of
// propagating -- the caller (`src/index.ts`) decides what to do with it
// (`onError` fan-out).
export async function runAfterChain(middlewares: Middleware[], event: CanonicalEvent): Promise<AfterChainResult> {
  const ranMiddlewares: Middleware[] = [];

  for (const middleware of middlewares) {
    ranMiddlewares.push(middleware);

    if (!middleware.after) {
      continue;
    }

    try {
      await middleware.after(event);
    } catch (error) {
      return { ranMiddlewares, threw: true, error };
    }
  }

  return { ranMiddlewares, threw: false };
}
