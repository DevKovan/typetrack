import { noopProvider, type AnalyticsProvider, type ProviderCapabilities } from "./providers";
import { normalizeProviders, shouldRouteToProvider, sortByPriority } from "./routing";
import type { ProviderEntry } from "./routing";
import { EventValidationError } from "./schema";
import type { CanonicalEvent, EventMap, SchemaMap, TrackArgs, TrackOptions } from "./schema";

export { noopProvider } from "./providers";
export type { AnalyticsProvider, ProviderCapabilities } from "./providers";
export type { ProviderEntry, RouteMatcher } from "./routing";
export type { CanonicalEvent, EventMap, InferEvents, SchemaMap, TrackOptions } from "./schema";
export { EventValidationError } from "./schema";

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
}

const DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:4318/events";

function resolveDevServerUrl(
  devServer: CreateAnalyticsOptions["devServer"],
): string | undefined {
  if (!devServer) return undefined;
  if (devServer === true) return DEFAULT_DEV_SERVER_URL;
  return devServer.url ?? DEFAULT_DEV_SERVER_URL;
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

  // Identity/session state now lives in core, generated once at
  // construction, in-memory only -- no persistence across process restarts.
  // Adapters no longer generate or own any of this. One set of identity
  // fields is shared across every provider in the list (not per-provider).
  let anonymousId = crypto.randomUUID();
  let sessionId = crypto.randomUUID();
  let userId: string | undefined;

  // Backs the one-warning-per-`${provider.name}:${capability}` policy below.
  // A single `Set<string>` closure variable naturally provides "per-provider"
  // dedup already, since the key includes `provider.name`.
  const warnedCapabilities = new Set<string>();

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

  // Fans a call out to every entry in `entries`, invoking `invoke(entry)`
  // for each (an `invoke` that decides to skip an entry -- routing/
  // capability gating -- simply returns without calling the provider).
  // Every entry's outcome is awaited via `Promise.allSettled`: a rejection
  // (thrown synchronously or a rejected Promise) is swallowed and reported
  // via `console.warn`, mentioning the provider's name, the verb, and the
  // rejection reason -- every failure warns, this is never deduped the way
  // capability warnings are. `dispatchToProviders` itself never rejects.
  async function dispatchToProviders(
    entries: ProviderEntry[],
    verb: string,
    invoke: (entry: ProviderEntry) => void | Promise<void>,
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
      }
    }
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
      context: verbOptions?.context,
      metadata: verbOptions?.metadata,
    };
  }

  return {
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
        context: trackOptions?.context,
        metadata: trackOptions?.metadata,
      };

      // `track()` is never capability-gated -- `AnalyticsProvider.track` is
      // a required (non-optional) field, always called directly.
      if (!normalized.isMulti) {
        return normalized.entries[0]!.provider.track(canonicalEvent);
      }

      const sorted = sortByPriority(normalized.entries);
      return dispatchToProviders(sorted, "track", (entry) => {
        // Routing is evaluated before anything else: an entry excluded by
        // routing is never a candidate for the call at all, so it never
        // triggers a capability warning either (moot here since `track`
        // isn't capability-gated, but keeps the same order as page/screen).
        if (!shouldRouteToProvider(entry, canonicalEvent)) return;
        return entry.provider.track(canonicalEvent);
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
      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        if (!isCapabilitySupported(entry, "page")) return;
        const canonicalEvent = buildEvent(name, props, pageOptions);
        return entry.provider.page?.(canonicalEvent);
      }

      const canonicalEvent = buildEvent(name, props, pageOptions);
      const sorted = sortByPriority(normalized.entries);
      return dispatchToProviders(sorted, "page", (entry) => {
        if (!shouldRouteToProvider(entry, canonicalEvent)) return;
        if (!isCapabilitySupported(entry, "page")) return;
        return entry.provider.page?.(canonicalEvent);
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
      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        if (!isCapabilitySupported(entry, "screen")) return;
        const canonicalEvent = buildEvent(name, props, screenOptions);
        return entry.provider.screen?.(canonicalEvent);
      }

      const canonicalEvent = buildEvent(name, props, screenOptions);
      const sorted = sortByPriority(normalized.entries);
      return dispatchToProviders(sorted, "screen", (entry) => {
        if (!shouldRouteToProvider(entry, canonicalEvent)) return;
        if (!isCapabilitySupported(entry, "screen")) return;
        return entry.provider.screen?.(canonicalEvent);
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

      // Minimal correct multi-provider iteration -- swallow-and-warn on
      // rejection, same as every other fan-out verb. Issue 004 changes this
      // to throw an `AggregateError` instead; out of scope here.
      await dispatchToProviders(normalized.entries, "flush", (entry) => entry.provider.flush?.());
    },
    async destroy() {
      // Drain first, then tear down, per provider. Not capability-gated.
      if (!normalized.isMulti) {
        await normalized.entries[0]!.provider.flush?.();
        await normalized.entries[0]!.provider.destroy?.();
        return;
      }

      // Minimal correct multi-provider iteration -- swallow-and-warn on
      // rejection, same as every other fan-out verb. Issue 004 changes this
      // to throw an `AggregateError` instead; out of scope here.
      await dispatchToProviders(normalized.entries, "destroy", async (entry) => {
        await entry.provider.flush?.();
        await entry.provider.destroy?.();
      });
    },
  };
}
