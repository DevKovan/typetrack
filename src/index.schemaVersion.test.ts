import { describe, expect, it, mock } from "bun:test";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";
import { allCapabilities } from "./test-support";

type SampleEvents = {
  signup_completed: { plan: string; source: string };
};

describe("createAnalytics({ schemaVersion }) unit tests", () => {
  it("schemaVersion omitted (default): metadata is exactly trackOptions?.metadata, undefined when nothing passed", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("signup_completed", { plan: "free", source: "ad" });

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.metadata).toBeUndefined();
  });

  it("schemaVersion omitted (default): metadata is preserved byte-for-byte when trackOptions.metadata is passed", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track(
      "signup_completed",
      { plan: "free", source: "ad" },
      { metadata: { source: "campaign" } },
    );

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.metadata).toEqual({ source: "campaign" });
  });

  it("schemaVersion set, no trackOptions.metadata passed: metadata becomes { schemaVersion }", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({ provider, schemaVersion: "2026-08" });

    analytics.track("signup_completed", { plan: "free", source: "ad" });

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.metadata).toEqual({ schemaVersion: "2026-08" });
  });

  it("schemaVersion set, trackOptions.metadata passed with no schemaVersion key of its own: merged, both keys present", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({ provider, schemaVersion: "2026-08" });

    analytics.track(
      "signup_completed",
      { plan: "free", source: "ad" },
      { metadata: { source: "campaign" } },
    );

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.metadata).toEqual({ schemaVersion: "2026-08", source: "campaign" });
  });

  it("schemaVersion set, trackOptions.metadata.schemaVersion also explicitly passed: the call-site value wins", () => {
    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", capabilities: allCapabilities, track };

    const analytics = createAnalytics<SampleEvents>({ provider, schemaVersion: "2026-08" });

    analytics.track(
      "signup_completed",
      { plan: "free", source: "ad" },
      { metadata: { schemaVersion: "call-site-override" } },
    );

    expect(track).toHaveBeenCalledTimes(1);
    const [canonicalEvent] = track.mock.calls[0]!;
    expect(canonicalEvent.metadata).toEqual({ schemaVersion: "call-site-override" });
  });
});
