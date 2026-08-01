import { noopProvider, type AnalyticsProvider } from "./providers";
import { EventValidationError } from "./schema";
import type { EventMap, EventMeta, SchemaMap, TrackArgs } from "./schema";

export type { AnalyticsProvider } from "./providers";
export type { EventMap, EventMeta, InferEvents, SchemaMap } from "./schema";
export { EventValidationError } from "./schema";

export interface CreateAnalyticsOptions<Events extends EventMap = EventMap> {
  provider?: AnalyticsProvider;
  // Optional per-event Zod schemas. An event without an entry here is
  // forwarded unvalidated, exactly as in issue 001. See `SchemaMap`.
  schemas?: SchemaMap<Events>;
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

  return {
    track(event, ...args) {
      const rawPayload = args[0];
      const meta: EventMeta = { timestamp: Date.now() };

      const schema = schemas?.[event];
      let payload: Record<string, unknown>;
      if (schema) {
        const result = schema.safeParse(rawPayload);
        if (!result.success) {
          throw new EventValidationError(event as string, rawPayload, result.error);
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
