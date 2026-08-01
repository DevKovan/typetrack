import { noopProvider, type AnalyticsProvider } from "./providers";
import type { EventMap, EventMeta, TrackArgs } from "./schema";

export type { AnalyticsProvider } from "./providers";
export type { EventMap, EventMeta } from "./schema";

// `Events` isn't referenced in this interface's body yet, but keeping the
// factory's `Events` type parameter threaded through its options type here
// (rather than dropping it) keeps `createAnalytics<Events>(options)` sound
// and leaves room for future event-map-typed options (e.g. schema
// validation in a later issue) without a breaking signature change.
// oxlint-disable-next-line no-unused-vars
export interface CreateAnalyticsOptions<Events extends EventMap = EventMap> {
  provider?: AnalyticsProvider;
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

  return {
    track(event, ...args) {
      const payload = (args[0] ?? {}) as Record<string, unknown>;
      const meta: EventMeta = { timestamp: Date.now() };
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
