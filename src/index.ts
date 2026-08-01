import { noopProvider, type AnalyticsProvider } from "./providers";
import type { EventMeta } from "./schema";

export type { AnalyticsProvider } from "./providers";
export type { EventMeta } from "./schema";

export interface CreateAnalyticsOptions {
  provider?: AnalyticsProvider;
}

export interface Analytics {
  track(event: string, payload?: Record<string, unknown>): void | Promise<void>;
  identify(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
  page(name?: string, props?: Record<string, unknown>): void | Promise<void>;
  flush(): Promise<void>;
}

export function createAnalytics(options: CreateAnalyticsOptions = {}): Analytics {
  const provider = options.provider ?? noopProvider;

  return {
    track(event, payload = {}) {
      const meta: EventMeta = { timestamp: Date.now() };
      return provider.track(event, payload, meta);
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
