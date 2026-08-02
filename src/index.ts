import { noopProvider, type AnalyticsProvider, type ProviderCapabilities } from "./providers";
import { EventValidationError } from "./schema";
import type { CanonicalEvent, EventMap, SchemaMap, TrackArgs, TrackOptions } from "./schema";

export { noopProvider } from "./providers";
export type { AnalyticsProvider, ProviderCapabilities } from "./providers";
export type { CanonicalEvent, EventMap, InferEvents, SchemaMap, TrackOptions } from "./schema";
export { EventValidationError } from "./schema";

export interface CreateAnalyticsOptions<Events extends EventMap = EventMap> {
  provider?: AnalyticsProvider;
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
  const provider = options.provider ?? noopProvider;
  const schemas = options.schemas;
  const onValidationError = options.onValidationError;
  const devServerUrl = resolveDevServerUrl(options.devServer);

  // Identity/session state now lives in core, generated once at
  // construction, in-memory only -- no persistence across process restarts.
  // Adapters no longer generate or own any of this (issues 003-005 delete
  // that logic from each provider).
  let anonymousId = crypto.randomUUID();
  let sessionId = crypto.randomUUID();
  let userId: string | undefined;

  // Backs the one-warning-per-`${provider.name}:${capability}` policy below.
  const warnedCapabilities = new Set<string>();

  // Shared gate for the five capability-dependent verbs: returns `true` when
  // the resolved provider both declares the capability and implements the
  // corresponding optional method: `false` otherwise, after emitting exactly
  // one `console.warn` per unique `${provider.name}:${capability}` pair (the
  // first time that pair is seen -- never again for the same pair, even
  // across many calls). Never throws.
  function isCapabilitySupported(capability: GatedCapability): boolean {
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
      return provider.track(canonicalEvent);
    },
    identify(newUserId, traits) {
      // `identify()` is the only verb that updates core's current `userId`.
      userId = newUserId;
      if (!isCapabilitySupported("identify")) return;
      return provider.identify?.(newUserId, traits, anonymousId);
    },
    page(name, props, pageOptions) {
      if (!isCapabilitySupported("page")) return;
      const canonicalEvent: CanonicalEvent = {
        name: name ?? "",
        properties: props ?? {},
        timestamp: Date.now(),
        anonymousId,
        userId,
        sessionId,
        context: pageOptions?.context,
        metadata: pageOptions?.metadata,
      };
      return provider.page?.(canonicalEvent);
    },
    group(groupId, traits) {
      if (!isCapabilitySupported("group")) return;
      return provider.group?.(groupId, traits, { userId, anonymousId });
    },
    alias(newUserId, previousUserId) {
      // Does not mutate core's stored `userId` -- only `identify()` does.
      if (!isCapabilitySupported("alias")) return;
      return provider.alias?.(newUserId, previousUserId, anonymousId);
    },
    screen(name, props, screenOptions) {
      if (!isCapabilitySupported("screen")) return;
      const canonicalEvent: CanonicalEvent = {
        name: name ?? "",
        properties: props ?? {},
        timestamp: Date.now(),
        anonymousId,
        userId,
        sessionId,
        context: screenOptions?.context,
        metadata: screenOptions?.metadata,
      };
      return provider.screen?.(canonicalEvent);
    },
    reset() {
      // Eager, not lazy: identity is reassigned before `provider.reset?.()`
      // is invoked. Not capability-gated -- this is a lifecycle hook, not a
      // data verb, and `ProviderCapabilities` has no `reset` field.
      anonymousId = crypto.randomUUID();
      sessionId = crypto.randomUUID();
      userId = undefined;
      return provider.reset?.();
    },
    async flush() {
      await provider.flush?.();
    },
    async destroy() {
      // Drain first, then tear down. Not capability-gated.
      await provider.flush?.();
      await provider.destroy?.();
    },
  };
}
