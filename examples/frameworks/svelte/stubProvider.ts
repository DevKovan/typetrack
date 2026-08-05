import type { AnalyticsProvider } from "typetrack";

// A hand-written stub `AnalyticsProvider` -- never live vendor
// infrastructure -- passed to `createAnalytics({ provider })` so this
// example exercises the *real* `typetrack` + `@typetrack/svelte` call path
// end to end. Mirrors `examples/frameworks/vue/stubProvider.ts`'s own
// convention exactly (deliberately identical shape across all three
// tested-in-repo framework examples).
interface StubCallLogEntry {
  verb: "track" | "identify" | "flush";
  eventName?: string;
  userId?: string;
  traits?: Record<string, unknown>;
}

export interface StubProvider {
  provider: AnalyticsProvider;
  callLog: StubCallLogEntry[];
}

export function createStubProvider(): StubProvider {
  const callLog: StubCallLogEntry[] = [];

  const provider: AnalyticsProvider = {
    name: "examples-frameworks-svelte-stub",
    capabilities: {
      identify: true,
      group: false,
      alias: false,
      page: false,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      callLog.push({ verb: "track", eventName: event.name });
    },
    identify(userId, traits) {
      callLog.push({ verb: "identify", userId, traits });
    },
    async flush() {
      callLog.push({ verb: "flush" });
    },
  };

  return { provider, callLog };
}
