import { useContext } from "react";
import type { Analytics, EventMap } from "typetrack";
import { AnalyticsContext } from "./AnalyticsProvider";

// Reads the nearest ancestor `<AnalyticsProvider analytics={...}>`'s
// `Analytics` instance off context. Throws -- rather than returning
// `undefined` or a fake no-op `Analytics` -- when no ancestor provider is
// present, so a missing provider is a loud, immediate error instead of a
// silent no-op that could go unnoticed in production.
//
// Type-safety note: the return value is type-asserted to the caller's
// `Events` type parameter. This assertion is sound only insofar as the
// caller's `Events` actually matches whatever the nearest ancestor
// `<AnalyticsProvider analytics={...}>` was instantiated with -- the type
// system has no way to verify the two ends agree. This is the same
// fundamental limitation as any generic React context helper, and is a
// known, accepted limitation of this hook, not a defect.
export function useAnalytics<Events extends EventMap = EventMap>(): Analytics<Events> {
  const analytics = useContext(AnalyticsContext);

  if (analytics === undefined) {
    throw new Error(
      "useAnalytics() was called outside of an AnalyticsProvider. " +
        "Wrap your component tree in <AnalyticsProvider analytics={...}> " +
        "before calling useAnalytics().",
    );
  }

  return analytics as Analytics<Events>;
}
