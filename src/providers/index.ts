import type { CanonicalEvent } from "../schema";

// Declares which of the optional `AnalyticsProvider` verbs/features a given
// provider actually implements/supports, so core (issue 002) can gate calls
// (warn/no-op) instead of unconditionally invoking a method a real provider
// adapter never wired up.
export interface ProviderCapabilities {
  identify: boolean;
  group: boolean;
  alias: boolean;
  page: boolean;
  screen: boolean;
  batching: boolean;
  offline: boolean;
  featureFlags: boolean;
  sessionReplay: boolean;
  heatmaps: boolean;
}

export interface AnalyticsProvider {
  name: string;
  capabilities: ProviderCapabilities;
  init?(config: Record<string, unknown>): void | Promise<void>;
  track(event: CanonicalEvent): void | Promise<void>;
  identify?(userId: string, traits: Record<string, unknown> | undefined, anonymousId: string): void | Promise<void>;
  group?(groupId: string, traits: Record<string, unknown> | undefined, identity: { userId?: string; anonymousId: string }): void | Promise<void>;
  alias?(newUserId: string, previousUserId: string | undefined, anonymousId: string): void | Promise<void>;
  page?(event: CanonicalEvent): void | Promise<void>;
  screen?(event: CanonicalEvent): void | Promise<void>;
  flush?(): Promise<void>;
  reset?(): void | Promise<void>;
  destroy?(): Promise<void>;
}

// `noopProvider`'s entire purpose is to accept every call harmlessly as a
// safe default/test double. It implements every optional method as a
// genuine no-op and declares every capability `true` -- declaring any
// capability `false` would make core's Phase-6 capability-gating (issue 002)
// start silently warning/no-oping calls made against the *intentionally*
// do-nothing provider, which is exactly the opposite of what a no-op default
// should do.
export const noopProvider: AnalyticsProvider = {
  name: "noop",
  capabilities: { identify: true, group: true, alias: true, page: true, screen: true, batching: true, offline: true, featureFlags: true, sessionReplay: true, heatmaps: true },
  track() {},
  identify() {},
  group() {},
  alias() {},
  page() {},
  screen() {},
  async flush() {},
  reset() {},
  async destroy() {},
};
