import { inject } from "vue";
import type { Analytics, EventMap } from "typetrack";
import { analyticsKey } from "./plugin";

// Reads the app-level `Analytics` instance provided by
// `app.use(typetrackPlugin, { analytics })` via `inject()`. Throws --
// rather than returning `undefined` or a fake no-op `Analytics` -- when no
// ancestor `app.use(typetrackPlugin, ...)` call has provided one, so a
// missing plugin install is a loud, immediate error instead of a silent
// no-op that could go unnoticed in production. Mirrors
// `@typetrack/react`'s `useAnalytics()` throw contract exactly, per this
// phase's cross-framework naming/behavior consistency decision.
//
// Type-safety note: the return value is type-asserted to the caller's
// `Events` type parameter. This assertion is sound only insofar as the
// caller's `Events` actually matches whatever `app.use(typetrackPlugin, {
// analytics })` was actually installed with -- the type system has no way
// to verify the two ends agree. This is the same fundamental limitation as
// `@typetrack/react`'s `useAnalytics()`, and is a known, accepted
// limitation of this composable, not a defect.
export function useAnalytics<Events extends EventMap = EventMap>(): Analytics<Events> {
  const analytics = inject(analyticsKey);

  if (analytics === undefined) {
    throw new Error(
      "useAnalytics() was called without an ancestor app.use(typetrackPlugin, ...) " +
        "install. Install the plugin first: app.use(typetrackPlugin, { analytics }) " +
        "before calling useAnalytics().",
    );
  }

  return analytics as Analytics<Events>;
}
