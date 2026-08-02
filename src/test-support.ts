import type { ProviderCapabilities } from "./providers";

// Shared "every capability supported" fixture for hand-written
// `AnalyticsProvider` test doubles that aren't exercising issue 002's
// capability-gating behavior themselves (e.g. plain `track()` forwarding
// tests) -- keeps those provider literals from having to repeat all ten
// `ProviderCapabilities` fields inline. Tests that specifically exercise the
// gating policy declare their own narrower `capabilities` object instead.
export const allCapabilities: ProviderCapabilities = {
  identify: true,
  group: true,
  alias: true,
  page: true,
  screen: true,
  batching: true,
  offline: true,
  featureFlags: true,
  sessionReplay: true,
  heatmaps: true,
};

// Same fixture with every capability declared unsupported -- for tests that
// want a stub whose declared capabilities never satisfy the gate regardless
// of which optional methods happen to be present.
export const noCapabilities: ProviderCapabilities = {
  identify: false,
  group: false,
  alias: false,
  page: false,
  screen: false,
  batching: false,
  offline: false,
  featureFlags: false,
  sessionReplay: false,
  heatmaps: false,
};
