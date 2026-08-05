// No `/** @jsxImportSource solid-js */` pragma here, deliberately -- verified
// by hand, not assumed. This file imports `AnalyticsContext` from
// `./AnalyticsProvider` (a `.tsx` file), but the *type* it imports
// (`Context<Analytics<EventMap> | undefined>`, from `solid-js`'s own
// `createContext` return type) never references `JSX.Element`/any JSX
// namespace type at all -- `AnalyticsProviderProps.children: JSX.Element`
// lives only in `AnalyticsProvider.tsx`, not in anything this file imports.
// This file also contains no JSX syntax of its own to type-check. The
// per-file pragma only matters for files that either (a) contain literal
// JSX syntax needing a JSX factory/namespace resolved, or (b) reference the
// ambient `JSX` namespace by name -- neither applies here, so omitting the
// pragma is correct, not an oversight. `bun run typecheck`/`typecheck:tsc`
// (both run in CI) are the actual verification that this holds.
import { useContext } from "solid-js";
import type { Analytics, EventMap } from "typetrack";
import { AnalyticsContext } from "./AnalyticsProvider";

// Reads the nearest ancestor `<AnalyticsProvider analytics={...}>`'s
// `Analytics` instance off Solid's Context API. Throws -- rather than
// returning `undefined` or a fake no-op `Analytics` -- when no ancestor
// provider is present, so a missing provider is a loud, immediate error
// instead of a silent no-op that could go unnoticed in production. Mirrors
// every other package's `useAnalytics()` throw contract in this phase
// exactly (deliberate cross-framework naming/behavior consistency, not a
// Solid-idiomatic alternative name).
//
// Type-safety note: the return value is type-asserted to the caller's
// `Events` type parameter. This assertion is sound only insofar as the
// caller's `Events` actually matches whatever the nearest ancestor
// `<AnalyticsProvider analytics={...}>` was instantiated with -- the type
// system has no way to verify the two ends agree. This is the same
// fundamental limitation as every other framework's generic context helper
// in this phase, and is a known, accepted limitation of this function, not a
// defect.
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
