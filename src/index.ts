import { captureDynamicContext, captureStaticContext } from "./context";
import type { ContextOptions } from "./context";
import { runAfterChain, runBeforeChain, type Middleware } from "./middleware";
import type { Plugin } from "./plugins";
import { noopProvider, type AnalyticsProvider, type ProviderCapabilities } from "./providers";
import { normalizeProviders, shouldRouteToProvider, sortByPriority } from "./routing";
import type { ProviderEntry } from "./routing";
import { EventValidationError } from "./schema";
import type { CanonicalEvent, EventMap, SchemaMap, TrackArgs, TrackOptions } from "./schema";

export type { Middleware } from "./middleware";
export { redactMiddleware } from "./middleware/redact";
export type { RedactOptions } from "./middleware/redact";
export { samplingMiddleware } from "./middleware/sampling";
export type { SamplingOptions } from "./middleware/sampling";
export { loggingMiddleware } from "./middleware/logging";
export type { LoggingOptions } from "./middleware/logging";
export { enrichmentMiddleware } from "./middleware/enrichment";
export type { EnrichmentOptions } from "./middleware/enrichment";
export { versionMiddleware } from "./middleware/version";
export type { VersionOptions } from "./middleware/version";
export { timingMiddleware } from "./middleware/timing";
export type { TimingOptions } from "./middleware/timing";
export { noopProvider } from "./providers";
export type { AnalyticsProvider, ProviderCapabilities } from "./providers";
export type { ProviderEntry, RouteMatcher } from "./routing";
export type { CanonicalEvent, EventMap, InferEvents, SchemaMap, TrackOptions } from "./schema";
export { EventValidationError } from "./schema";
export type { CapturedContext, ContextOptions } from "./context";
export { isBrowserEnvironment } from "./context";
export type { Plugin } from "./plugins";
export { autoPage, dispatchPageView } from "./plugins/autoPage";
export type { PageViewArgs, AutoPageOptions } from "./plugins/autoPage";
export { autoClicks } from "./plugins/autoClicks";
export type { AutoClicksOptions } from "./plugins/autoClicks";
export { autoScroll } from "./plugins/autoScroll";
export type { AutoScrollOptions } from "./plugins/autoScroll";
export { autoVisibility } from "./plugins/autoVisibility";
export { autoErrors } from "./plugins/autoErrors";
export { autoWebVitals } from "./plugins/autoWebVitals";
export type { WebVitalName, WebVitalRating } from "./plugins/autoWebVitals";
export { autoPerformance } from "./plugins/autoPerformance";
export type { PagePerformanceProperties } from "./plugins/autoPerformance";
export { autoUTM } from "./plugins/autoUTM";
export type { AutoUTMOptions } from "./plugins/autoUTM";

export interface CreateAnalyticsOptions<Events extends EventMap = EventMap> {
  // A single bare provider keeps exact Phase 6 passthrough behavior (no
  // routing evaluation, no `Promise.allSettled` fan-out wrapping). Wrapping
  // it in a `ProviderEntry`, or supplying an array (of any length, including
  // 0 or 1), opts into the multi-provider fan-out path -- see
  // `src/routing.ts`'s `normalizeProviders`/`NormalizedProviders.isMulti`.
  provider?: AnalyticsProvider | ProviderEntry | (AnalyticsProvider | ProviderEntry)[];
  // Optional per-event Zod schemas. An event without an entry here is
  // forwarded unvalidated, exactly as in issue 001. See `SchemaMap`.
  schemas?: SchemaMap<Events>;
  // Optional opt-out from the issue-002 default (`track()` throwing a
  // synchronous `EventValidationError` on a failed validation). When
  // supplied, a failed validation instead calls this handler with the
  // `EventValidationError` and `track()` returns normally without calling
  // the provider. If the handler itself throws, that exception propagates
  // out of `track()` as-is -- it is not swallowed.
  onValidationError?: (error: EventValidationError) => void;
  // Opt-in dev-mode mirroring of every `track()` call to a locally running
  // `startDevServer()` (see `src/devServer/`). `true` posts to the dev
  // server's own default (`http://127.0.0.1:4318/events`); `{ url }` posts
  // to an exact URL instead, for when the app developer has read the real
  // running port (e.g. from `.typetrack/port`) themselves. Core never
  // inspects `NODE_ENV`/`import.meta.env` or reads any file on its own to
  // decide this -- gating "am I in dev" is entirely the caller's
  // responsibility. See issue 006 for the full rationale.
  devServer?: boolean | { url?: string };
  // Opt-in automatic environment/session context capture, merged onto
  // `CanonicalEvent.context` for `track`/`page`/`screen` only (`identify`/
  // `group`/`alias`/`reset`/`flush`/`destroy` have no `CanonicalEvent` and
  // are unaffected). `true` is shorthand for `{ autoCapture: true }`.
  // Omitted (the default), `false`, or `{ autoCapture: false }` are all
  // equivalent to "off" -- zero behavior change from pre-Phase-9:
  // `CanonicalEvent.context` remains exactly `verbOptions?.context`
  // (`undefined` when not supplied), with no `Intl`/UA work performed at
  // all. See `src/context.ts` for the captured shape
  // (`CapturedContext`/`ContextOptions`).
  context?: boolean | ContextOptions;
  // Plugins to auto-invoke once, in array order, at construction time --
  // distinct from `.use()` (Phase 8 middleware, which transforms/observes
  // events already in flight; plugins instead originate new track calls of
  // their own). Each plugin is called with the fully-constructed `Analytics`
  // instance; its optional returned teardown function (if any) is invoked by
  // `destroy()`, before the existing provider flush+destroy logic. See
  // `src/plugins.ts` for the full `Plugin` contract.
  plugins?: Plugin[];
}

const DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:4318/events";

function resolveDevServerUrl(
  devServer: CreateAnalyticsOptions["devServer"],
): string | undefined {
  if (!devServer) return undefined;
  if (devServer === true) return DEFAULT_DEV_SERVER_URL;
  return devServer.url ?? DEFAULT_DEV_SERVER_URL;
}

// Mirrors `resolveDevServerUrl`'s normalization pattern. Returns `undefined`
// for any falsy input (including `{ autoCapture: false }`) so the rest of
// `createAnalytics()` has a single "off" signal to check (`staticContext ===
// undefined`) rather than re-deriving this in multiple places.
function resolveContextOptions(
  context: CreateAnalyticsOptions["context"],
): ContextOptions | undefined {
  if (!context) return undefined;
  if (context === true) return { autoCapture: true };
  return context.autoCapture ? context : undefined;
}

// The five verbs whose behavior depends on whether the resolved provider
// actually implements them: an app can call `identify()`/`page()`/`group()`/
// `alias()`/`screen()` against any provider regardless of what that
// provider's adapter actually wired up -- providers that don't support a
// given verb (declared via `capabilities`, or simply missing the optional
// method) get a one-time `console.warn` instead of a thrown exception or a
// silent-but-wrong call into `undefined`.
type GatedCapability = "identify" | "page" | "group" | "alias" | "screen";

export interface Analytics<Events extends EventMap = EventMap> {
  track<K extends keyof Events>(event: K, ...args: TrackArgs<Events[K]>): void | Promise<void>;
  identify(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
  page(name?: string, props?: Record<string, unknown>, options?: TrackOptions): void | Promise<void>;
  group(groupId: string, traits?: Record<string, unknown>): void | Promise<void>;
  alias(newUserId: string, previousUserId?: string): void | Promise<void>;
  screen(name?: string, props?: Record<string, unknown>, options?: TrackOptions): void | Promise<void>;
  reset(): void | Promise<void>;
  flush(): Promise<void>;
  destroy(): Promise<void>;
  // Registers a middleware onto this instance's chain. Accumulates in
  // registration order -- no dedup by `Middleware.name`. Purely additive as
  // of this issue: registered middlewares are not yet consumed by
  // `track`/`page`/`screen` (issue 002 wires that in).
  use(middleware: Middleware): void;
  // `enable()`/`disable()` (privacy/consent gating) are intentionally not
  // part of this interface yet -- deferred to the Privacy/consent phase.
}

export function createAnalytics<Events extends EventMap = EventMap>(
  options: CreateAnalyticsOptions<Events> = {},
): Analytics<Events> {
  // `normalizeProviders` doesn't own the `noopProvider` default (issue 001's
  // contract) -- it's applied here, before normalization, exactly once at
  // construction. Construction-time `include`+`exclude` conflicts throw
  // synchronously out of `normalizeProviders`, and therefore out of
  // `createAnalytics()` itself.
  const normalized = normalizeProviders(options.provider ?? noopProvider);
  const schemas = options.schemas;
  const onValidationError = options.onValidationError;
  const devServerUrl = resolveDevServerUrl(options.devServer);

  // `undefined` here is this issue's single "auto-capture is off" signal --
  // every call site below gates on `contextOptions`/`staticContext` being
  // truthy before doing any work.
  const contextOptions = resolveContextOptions(options.context);
  // Captured exactly once, at construction time, only when auto-capture is
  // on -- never re-invoked per call (that's `captureDynamicContext`'s job,
  // below). Left `undefined` (not even attempted) when auto-capture is off,
  // per this issue's hot-path/back-compat requirement: no `Intl`/UA work at
  // all for apps that never opted in.
  const staticContext = contextOptions ? captureStaticContext() : undefined;

  // Identity/session state now lives in core, generated once at
  // construction, in-memory only -- no persistence across process restarts.
  // Adapters no longer generate or own any of this. One set of identity
  // fields is shared across every provider in the list (not per-provider).
  let anonymousId = crypto.randomUUID();
  let sessionId = crypto.randomUUID();
  let userId: string | undefined;

  // Session bookkeeping (`context.session`, additive to `sessionId` --
  // Phase 9). Cheap to initialize unconditionally (`Date.now()`/`0`), but
  // only ever read/merged into an event's `context` when auto-capture is on.
  let sessionStartedAt = Date.now();
  let sessionEventCount = 0;

  // Backs the one-warning-per-`${provider.name}:${capability}` policy below.
  // A single `Set<string>` closure variable naturally provides "per-provider"
  // dedup already, since the key includes `provider.name`.
  const warnedCapabilities = new Set<string>();

  // Registered middlewares, in registration order. Populated by `use()`
  // below and consumed by `track`/`page`/`screen` via `runThroughMiddleware`
  // (this issue). `identify`/`group`/`alias`/`reset`/`flush`/`destroy` never
  // read this array -- no canonical event exists for those verbs.
  const middlewares: Middleware[] = [];

  // Shared gate for the five capability-dependent verbs: returns `true` when
  // `entry.provider` both declares the capability and implements the
  // corresponding optional method; `false` otherwise, after emitting exactly
  // one `console.warn` per unique `${provider.name}:${capability}` pair (the
  // first time that pair is seen -- never again for the same pair, even
  // across many calls, and independently per provider in a fan-out list).
  // Never throws.
  function isCapabilitySupported(entry: ProviderEntry, capability: GatedCapability): boolean {
    const provider = entry.provider;
    const method = provider[capability];
    if (provider.capabilities[capability as keyof ProviderCapabilities] && typeof method === "function") {
      return true;
    }
    const key = `${provider.name}:${capability}`;
    if (!warnedCapabilities.has(key)) {
      warnedCapabilities.add(key);
      console.warn(
        `typetrack: provider "${provider.name}" does not support "${capability}" -- ${capability}() call ignored.`,
      );
    }
    return false;
  }

  // Notifies every middleware in `targets` (in registration order) whose
  // `onError` is defined, for a single failure (`error`/`event`/`ctx`).
  // Issue 003's swallow policy: `onError` handlers never propagate -- if
  // calling one throws/rejects, it's caught, `console.warn`'d, and the loop
  // continues to the next middleware's `onError`, so one broken handler
  // never prevents another middleware from being notified of the same
  // failure (and never crashes `track()`/`page()`/`screen()`).
  async function notifyOnError(
    targets: Middleware[],
    error: unknown,
    event: CanonicalEvent,
    ctx: { source: "middleware" | "provider"; providerName?: string },
  ): Promise<void> {
    for (const middleware of targets) {
      if (!middleware.onError) continue;
      try {
        await middleware.onError(error, event, ctx);
      } catch (onErrorFailure) {
        console.warn(
          `typetrack: middleware "${middleware.name}"'s onError() handler itself threw -- ${onErrorFailure}`,
        );
      }
    }
  }

  // Fans a call out to every entry in `entries`, invoking `invoke(entry)`
  // for each (an `invoke` that decides to skip an entry -- routing/
  // capability gating -- simply returns without calling the provider).
  // Every entry's outcome is awaited via `Promise.allSettled`: a rejection
  // (thrown synchronously or a rejected Promise) is swallowed and reported
  // via `console.warn`, mentioning the provider's name, the verb, and the
  // rejection reason -- every failure warns, this is never deduped the way
  // capability warnings are. `dispatchToProviders` itself never rejects.
  //
  // `onProviderError` (issue 003, optional): when supplied, called once per
  // rejected entry, after that entry's `console.warn` has already fired
  // (chosen order -- either is acceptable per the issue, this is the
  // implementation's choice), so `onError` fan-out is additive to, never a
  // replacement for, the existing warning. Only `track`/`page`/`screen`'s
  // call sites pass this (they're the only verbs with a `CanonicalEvent`
  // and a middleware chain); `identify`/`group`/`alias`/`reset` never do, so
  // their behavior is entirely unchanged by this issue.
  async function dispatchToProviders(
    entries: ProviderEntry[],
    verb: string,
    invoke: (entry: ProviderEntry) => void | Promise<void>,
    onProviderError?: (entry: ProviderEntry, error: unknown) => void | Promise<void>,
  ): Promise<void> {
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        await invoke(entry);
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        console.warn(
          `typetrack: provider "${entries[i]!.provider.name}" failed during "${verb}()" -- ${result.reason}`,
        );
        if (onProviderError) {
          await onProviderError(entries[i]!, result.reason);
        }
      }
    }
  }

  // Wraps a single-provider (non-multi) fast path's direct
  // `entry.provider.track/page/screen(event)` call (issue 003): detects a
  // synchronous throw or a rejected returned Promise, and on failure,
  // reports it exactly as `dispatchToProviders` does for the multi-provider
  // case -- `console.warn` (mentioning provider name, verb, rejection
  // reason), then `onError` fan-out to every registered middleware with
  // `source: "provider"` -- then swallows it (the verb resolves normally).
  // On success, `call()`'s own return value (sync `void`, or a `Promise`)
  // passes through untouched -- no extra microtask tick, no forced `Promise`
  // wrapping, preserving the fast path's zero-overhead contract for the
  // non-failing case.
  function callSingleProvider(
    entry: ProviderEntry,
    verb: string,
    event: CanonicalEvent,
    call: () => void | Promise<void>,
  ): void | Promise<void> {
    function handleFailure(error: unknown): Promise<void> {
      console.warn(`typetrack: provider "${entry.provider.name}" failed during "${verb}()" -- ${error}`);
      return notifyOnError(middlewares, error, event, { source: "provider", providerName: entry.provider.name });
    }

    try {
      const result = call();
      if (result && typeof (result as Promise<void>).then === "function") {
        return (result as Promise<void>).catch(handleFailure);
      }
      return result;
    } catch (error) {
      return handleFailure(error);
    }
  }

  // Collects rejection reasons from a `Promise.allSettled` fan-out, without
  // swallowing/warning -- distinct contract from `dispatchToProviders`.
  // Every entry still gets the chance to settle (never fail-fast); the
  // caller decides what to do with the returned reasons (issue 004: `flush`/
  // `destroy` throw a combined `AggregateError` if this is non-empty).
  async function settleAll(
    entries: ProviderEntry[],
    invoke: (entry: ProviderEntry) => void | Promise<void>,
  ): Promise<unknown[]> {
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        await invoke(entry);
      }),
    );
    const reasons: unknown[] = [];
    for (const result of results) {
      if (result.status === "rejected") {
        reasons.push(result.reason);
      }
    }
    return reasons;
  }

  // Shared by `buildEvent()` (`page`/`screen`) and `track()`'s inline
  // canonical-event construction -- both call sites need identical merge
  // logic, so it's factored into this one closure function rather than
  // duplicated inline in two places. Needs access to `staticContext`/
  // `contextOptions`/`sessionStartedAt`/`sessionEventCount` closure state,
  // so it lives here rather than as a standalone pure export the way
  // `src/context.ts`'s functions are.
  //
  // When auto-capture is off (`staticContext` is `undefined`): behavior is
  // byte-for-byte unchanged from pre-Phase-9 -- returns exactly
  // `verbOptions?.context`, no new object allocation, no session-count
  // increment.
  //
  // When auto-capture is on: increments `sessionEventCount`, captures fresh
  // dynamic context, and shallow-merges `{ ...staticContext, ...dynamicContext,
  // session: {...}, ...verbOptions?.context }` -- the caller's `context` is
  // spread last and wins on key collision (not deep-merged: a caller-supplied
  // key fully overwrites the auto-captured value for that key).
  function resolveEventContext(verbOptions: TrackOptions | undefined): Record<string, unknown> | undefined {
    if (!staticContext) {
      return verbOptions?.context;
    }

    sessionEventCount += 1;
    const dynamicContext = captureDynamicContext(contextOptions);
    const durationMs = Date.now() - sessionStartedAt;

    const merged: Record<string, unknown> = {
      ...staticContext,
      ...dynamicContext,
      session: {
        startedAt: sessionStartedAt,
        eventCount: sessionEventCount,
        durationMs,
      },
      ...verbOptions?.context,
    };

    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  function buildEvent(
    name: string | undefined,
    props: Record<string, unknown> | undefined,
    verbOptions: TrackOptions | undefined,
  ): CanonicalEvent {
    return {
      name: name ?? "",
      properties: props ?? {},
      timestamp: Date.now(),
      anonymousId,
      userId,
      sessionId,
      context: resolveEventContext(verbOptions),
      metadata: verbOptions?.metadata,
    };
  }

  // Runs `track`/`page`/`screen`'s canonical event through the registered
  // middleware chain, then `dispatch` (single-provider fast path or
  // Phase 7's routing/fan-out), then `after()`, in the exact order locked by
  // this issue: before-chain -> (drop check) -> dispatch -> after-chain.
  // `dispatch` receives the post-`before`-chain event, so routing/capability
  // gating/provider calls all see the (possibly transformed) event, never
  // the pre-middleware one.
  //
  // Zero-middleware fast path: `runBeforeChain`/`runAfterChain` are skipped
  // entirely (not just no-op'd) so that `dispatch`'s own return value --
  // `void` for the single-provider fast path calling a synchronous
  // provider, or a `Promise<void>` otherwise -- passes through completely
  // unwrapped, keeping zero-middleware behavior byte-for-byte identical to
  // the end of Phase 7 (no extra microtask tick, no forced `Promise` return
  // where none existed before).
  //
  // A `before()` that drops the event (returns `null`/`undefined`) causes
  // this to resolve with no call to `dispatch` and no call to `after()` --
  // the verb resolves normally, exactly as if the app itself never called
  // it for that invocation.
  //
  // Errors thrown by `before()`/`after()` (issue 003): reported via
  // `onError` instead of propagating. A `before()` throw is fanned out to
  // the throwing middleware and every middleware before it in registration
  // order (`before.ranMiddlewares` -- the chain never reaches later
  // middlewares, mirroring a drop's short-circuit), then treated like a
  // drop (no `dispatch`, no `after`). An `after()` throw is fanned out
  // identically (`after.ranMiddlewares`), but `dispatch` has already run by
  // that point -- the event was genuinely delivered, this isn't a drop.
  // Provider-dispatch rejections are handled inside `dispatch` itself (see
  // `dispatchToProviders`'s `onProviderError` / `callSingleProvider`) --
  // this function never needs to know about those.
  function runThroughMiddleware(
    canonicalEvent: CanonicalEvent,
    dispatch: (event: CanonicalEvent) => void | Promise<void>,
  ): void | Promise<void> {
    if (middlewares.length === 0) {
      return dispatch(canonicalEvent);
    }

    return (async () => {
      const before = await runBeforeChain(middlewares, canonicalEvent);
      if (before.threw) {
        await notifyOnError(before.ranMiddlewares, before.error, before.event, { source: "middleware" });
        return;
      }
      if (before.dropped) return;

      await dispatch(before.event);

      const after = await runAfterChain(middlewares, before.event);
      if (after.threw) {
        await notifyOnError(after.ranMiddlewares, after.error, before.event, { source: "middleware" });
      }
    })();
  }

  const analytics: Analytics<Events> = {
    track(event, ...args) {
      const [rawPayload, trackOptions] = args as [unknown, TrackOptions | undefined];

      // Fire-and-forget mirror to the dev server, dispatched with the raw,
      // unvalidated payload before schema validation runs below -- must fire
      // regardless of whether a schema exists, whether validation
      // succeeds/fails, or whether `onValidationError` is set. Never
      // returned/awaited; any failure (rejected fetch, non-2xx, no listener)
      // is silently swallowed with no default logging.
      if (devServerUrl) {
        void fetch(devServerUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event, payload: rawPayload }),
        }).catch(() => {});
      }

      const schema = schemas?.[event];
      let payload: Record<string, unknown>;
      if (schema) {
        const result = schema.safeParse(rawPayload);
        if (!result.success) {
          const error = new EventValidationError(event as string, rawPayload, result.error);
          if (onValidationError) {
            onValidationError(error);
            return;
          }
          throw error;
        }
        payload = (result.data ?? {}) as Record<string, unknown>;
      } else {
        payload = (rawPayload ?? {}) as Record<string, unknown>;
      }

      const canonicalEvent: CanonicalEvent = {
        name: event as string,
        properties: payload,
        timestamp: Date.now(),
        anonymousId,
        userId,
        sessionId,
        context: resolveEventContext(trackOptions),
        metadata: trackOptions?.metadata,
      };

      return runThroughMiddleware(canonicalEvent, (evt) => {
        // `track()` is never capability-gated -- `AnalyticsProvider.track`
        // is a required (non-optional) field, always called directly.
        if (!normalized.isMulti) {
          const entry = normalized.entries[0]!;
          return callSingleProvider(entry, "track", evt, () => entry.provider.track(evt));
        }

        const sorted = sortByPriority(normalized.entries);
        return dispatchToProviders(
          sorted,
          "track",
          (entry) => {
            // Routing is evaluated before anything else: an entry excluded by
            // routing is never a candidate for the call at all, so it never
            // triggers a capability warning either (moot here since `track`
            // isn't capability-gated, but keeps the same order as page/screen).
            // `evt` is the post-`before`-chain event -- routing sees the
            // (possibly transformed) event, never the pre-middleware one.
            if (!shouldRouteToProvider(entry, evt)) return;
            return entry.provider.track(evt);
          },
          (entry, error) =>
            notifyOnError(middlewares, error, evt, { source: "provider", providerName: entry.provider.name }),
        );
      });
    },
    identify(newUserId, traits) {
      // `identify()` is the only verb that updates core's current `userId`.
      userId = newUserId;

      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        if (!isCapabilitySupported(entry, "identify")) return;
        return entry.provider.identify?.(newUserId, traits, anonymousId);
      }

      // Always fans out to every provider unconditionally -- no routing
      // evaluation for identify/group/alias/reset. Original array order is
      // used (not `sortByPriority`): priority ordering only matters for the
      // routable verbs (track/page/screen), where call order interacts with
      // routing/sampling side effects; the always-fan-out verbs have no such
      // interaction; iterating in original declared order is simpler and
      // keeps ordering predictable to callers who declared their array in a
      // particular order.
      return dispatchToProviders(normalized.entries, "identify", (entry) => {
        if (!isCapabilitySupported(entry, "identify")) return;
        return entry.provider.identify?.(newUserId, traits, anonymousId);
      });
    },
    page(name, props, pageOptions) {
      const canonicalEvent = buildEvent(name, props, pageOptions);

      return runThroughMiddleware(canonicalEvent, (evt) => {
        if (!normalized.isMulti) {
          const entry = normalized.entries[0]!;
          if (!isCapabilitySupported(entry, "page")) return;
          return callSingleProvider(entry, "page", evt, () => entry.provider.page?.(evt));
        }

        const sorted = sortByPriority(normalized.entries);
        return dispatchToProviders(
          sorted,
          "page",
          (entry) => {
            if (!shouldRouteToProvider(entry, evt)) return;
            if (!isCapabilitySupported(entry, "page")) return;
            return entry.provider.page?.(evt);
          },
          (entry, error) =>
            notifyOnError(middlewares, error, evt, { source: "provider", providerName: entry.provider.name }),
        );
      });
    },
    group(groupId, traits) {
      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        if (!isCapabilitySupported(entry, "group")) return;
        return entry.provider.group?.(groupId, traits, { userId, anonymousId });
      }

      return dispatchToProviders(normalized.entries, "group", (entry) => {
        if (!isCapabilitySupported(entry, "group")) return;
        return entry.provider.group?.(groupId, traits, { userId, anonymousId });
      });
    },
    alias(newUserId, previousUserId) {
      // Does not mutate core's stored `userId` -- only `identify()` does.
      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        if (!isCapabilitySupported(entry, "alias")) return;
        return entry.provider.alias?.(newUserId, previousUserId, anonymousId);
      }

      return dispatchToProviders(normalized.entries, "alias", (entry) => {
        if (!isCapabilitySupported(entry, "alias")) return;
        return entry.provider.alias?.(newUserId, previousUserId, anonymousId);
      });
    },
    screen(name, props, screenOptions) {
      const canonicalEvent = buildEvent(name, props, screenOptions);

      return runThroughMiddleware(canonicalEvent, (evt) => {
        if (!normalized.isMulti) {
          const entry = normalized.entries[0]!;
          if (!isCapabilitySupported(entry, "screen")) return;
          return callSingleProvider(entry, "screen", evt, () => entry.provider.screen?.(evt));
        }

        const sorted = sortByPriority(normalized.entries);
        return dispatchToProviders(
          sorted,
          "screen",
          (entry) => {
            if (!shouldRouteToProvider(entry, evt)) return;
            if (!isCapabilitySupported(entry, "screen")) return;
            return entry.provider.screen?.(evt);
          },
          (entry, error) =>
            notifyOnError(middlewares, error, evt, { source: "provider", providerName: entry.provider.name }),
        );
      });
    },
    reset() {
      // Eager, not lazy: identity is reassigned before any provider's
      // `reset?.()` is invoked. Not capability-gated -- this is a lifecycle
      // hook, not a data verb, and `ProviderCapabilities` has no `reset`
      // field.
      anonymousId = crypto.randomUUID();
      sessionId = crypto.randomUUID();
      userId = undefined;
      // A fresh session context starts counting from zero again, consistent
      // with `sessionId` itself being reassigned above.
      sessionStartedAt = Date.now();
      sessionEventCount = 0;

      if (!normalized.isMulti) {
        return normalized.entries[0]!.provider.reset?.();
      }

      return dispatchToProviders(normalized.entries, "reset", (entry) => entry.provider.reset?.());
    },
    async flush() {
      if (!normalized.isMulti) {
        await normalized.entries[0]!.provider.flush?.();
        return;
      }

      // Unlike every other fan-out verb, `flush`/`destroy` do not
      // swallow-and-warn: every provider still gets the chance to settle
      // (never fail-fast), but a non-empty rejection list is thrown as a
      // real `AggregateError` -- no `console.warn` on this path, which would
      // double-report the same failures.
      const reasons = await settleAll(normalized.entries, (entry) => entry.provider.flush?.());
      if (reasons.length > 0) {
        throw new AggregateError(reasons, `typetrack: ${reasons.length} provider(s) failed during flush()`);
      }
    },
    async destroy() {
      // Plugin teardowns run first, in registration order, before any
      // provider flush/destroy work begins -- stops plugins from generating
      // new track()/page() calls while providers are mid-teardown. A
      // throwing teardown is swallowed and reported via console.warn (same
      // pattern as the rest of this function's swallow-and-warn
      // conventions); it does not join the AggregateError below, and never
      // prevents the remaining teardowns or the provider flush/destroy
      // phases from running.
      for (const teardown of pluginTeardowns) {
        try {
          teardown();
        } catch (error) {
          console.warn(`typetrack: a plugin's teardown threw during destroy() -- ${error}`);
        }
      }

      // Drain first, then tear down, per provider. Not capability-gated.
      if (!normalized.isMulti) {
        await normalized.entries[0]!.provider.flush?.();
        await normalized.entries[0]!.provider.destroy?.();
        return;
      }

      // Two phases across the whole array: every provider's flush is
      // allowed to settle first (collecting rejections, not throwing yet),
      // then every provider's destroy runs regardless of whether that same
      // provider's flush rejected -- teardown is not optional just because
      // draining failed. Rejections from both phases are combined into one
      // `AggregateError`, thrown only after both phases have fully settled.
      const flushReasons = await settleAll(normalized.entries, (entry) => entry.provider.flush?.());
      const destroyReasons = await settleAll(normalized.entries, (entry) => entry.provider.destroy?.());
      const reasons = [...flushReasons, ...destroyReasons];
      if (reasons.length > 0) {
        throw new AggregateError(reasons, `typetrack: ${reasons.length} provider(s) failed during destroy()`);
      }
    },
    use(middleware) {
      middlewares.push(middleware);
    },
  };

  // Plugins are invoked once, in array order, here -- after `analytics` is
  // fully constructed (every verb is callable from inside a plugin at setup
  // time) but before `createAnalytics()` returns. A throwing plugin setup is
  // swallowed and reported via `console.warn` (never propagates out of
  // `createAnalytics()`, never blocks a later plugin in the array from
  // running) -- mirrors the "never throw" contract established by Phase 9's
  // context capture and Phase 8's middleware `onError` handling.
  // `plugin.name` relies on `Function.prototype.name` -- see `src/plugins.ts`
  // for why every shipped plugin factory must return a named function
  // expression, not an anonymous arrow, for this warning to be legible.
  const pluginTeardowns: (() => void)[] = [];
  for (const plugin of options.plugins ?? []) {
    try {
      const teardown = plugin(analytics);
      if (teardown) pluginTeardowns.push(teardown);
    } catch (error) {
      console.warn(`typetrack: plugin "${plugin.name || "<anonymous>"}" threw during setup -- ${error}`);
    }
  }

  return analytics;
}
