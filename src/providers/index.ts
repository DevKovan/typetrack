import type { EventMeta } from "../schema";

export interface AnalyticsProvider {
  name: string;
  init?(config: Record<string, unknown>): void | Promise<void>;
  track(event: string, payload: Record<string, unknown>, meta: EventMeta): void | Promise<void>;
  identify?(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
  page?(name?: string, props?: Record<string, unknown>): void | Promise<void>;
  flush?(): Promise<void>;
}

export const noopProvider: AnalyticsProvider = {
  name: "noop",
  track() {},
};
