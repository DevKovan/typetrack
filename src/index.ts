import { noopProvider, type AnalyticsProvider } from "./providers";
import { EventValidationError } from "./schema";
import type { EventMap, EventMeta, SchemaMap, TrackArgs } from "./schema";

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

export interface Analytics<Events extends EventMap = EventMap> {
  track<K extends keyof Events>(event: K, ...args: TrackArgs<Events[K]>): void | Promise<void>;
  identify(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
  page(name?: string, props?: Record<string, unknown>): void | Promise<void>;
  flush(): Promise<void>;
}

export function createAnalytics<Events extends EventMap = EventMap>(
  options: CreateAnalyticsOptions<Events> = {},
): Analytics<Events> {
  const provider = options.provider ?? noopProvider;
  const schemas = options.schemas;
  const onValidationError = options.onValidationError;
  const devServerUrl = resolveDevServerUrl(options.devServer);

  return {
    track(event, ...args) {
      const rawPayload = args[0];
      const meta: EventMeta = { timestamp: Date.now() };

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

      return provider.track(event as string, payload, meta);
    },
    identify(userId, traits) {
      return provider.identify?.(userId, traits);
    },
    page(name, props) {
      return provider.page?.(name, props);
    },
    async flush() {
      await provider.flush?.();
    },
  };
}
