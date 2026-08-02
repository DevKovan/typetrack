// Compile-time typing tests for `AnalyticsProvider` (issue 001's rewrite).
//
// These assertions are enforced at *compile time* (via `bun run typecheck` /
// `typecheck:tsc`, both of which include this file through tsconfig's
// `include`): a `// @ts-expect-error` comment fails the build if the next
// line does *not* produce a type error, and any type error not covered by
// a `@ts-expect-error` also fails the build. The lone runtime `it` below
// just gives this file a visible presence in `bun test` output; it performs
// no assertions of its own.
import { describe, it } from "bun:test";
import type { CanonicalEvent } from "../schema";
import type { AnalyticsProvider } from "./index";

function typeLevelAssertions() {
  // @ts-expect-error missing `capabilities` does not satisfy `AnalyticsProvider`
  const missingCapabilities: AnalyticsProvider = {
    name: "missing-capabilities",
    track() {},
  };
  void missingCapabilities;

  const oldTrackShape: AnalyticsProvider = {
    name: "old-shape",
    capabilities: {
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
    },
    // @ts-expect-error `track` taking `(event: string, payload, meta)` (the old shape) does not satisfy `AnalyticsProvider`
    track(_event: string, _payload: Record<string, unknown>, _meta: { timestamp: number }) {},
  };
  void oldTrackShape;

  // Valid: a minimal provider with only the required `name`, `capabilities`,
  // and `track` -- every optional method omitted -- type-checks cleanly.
  const minimalProvider: AnalyticsProvider = {
    name: "minimal",
    capabilities: {
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
    },
    track(_event: CanonicalEvent) {},
  };
  void minimalProvider;
}
void typeLevelAssertions;

describe("AnalyticsProvider typing", () => {
  it("is enforced at compile time (see @ts-expect-error assertions above)", () => {
    // No runtime behavior to assert; this file's value is purely in
    // whether it typechecks. See `typeLevelAssertions` above.
  });
});
