import { getContext } from "svelte";
import type { Snippet } from "svelte";
import type { Analytics, EventMap } from "typetrack";

// A unique `Symbol`-backed context key. Unlike `@typetrack/vue`'s
// `InjectionKey<T>` (Vue's own generic wrapper letting `provide`/`inject`
// agree on the value type via the key itself), Svelte's `setContext`/
// `getContext` are typed as `setContext<T>(key: any, context: T): T` /
// `getContext<T>(key: any): T` -- the key carries no type information of its
// own, so type safety here comes entirely from the explicit type arguments
// at each call site (`AnalyticsProvider.svelte`'s `setContext<...>` call and
// `useAnalytics`'s `getContext<...>` call below), not from the key's own
// declared type.
export const ANALYTICS_KEY = Symbol("typetrack-analytics");

// Declared here (a plain `.ts` file), not inside `AnalyticsProvider.svelte`'s
// own `<script>` block, even though the prop it types belongs to that
// component: `tsc`/`tsgo` never parse `.svelte` syntax at all (see
// `AnalyticsProvider.svelte.d.ts`'s header comment), so a type declared only
// inside the `.svelte` file would be invisible to `AnalyticsProvider.svelte.
// d.ts` -- the hand-written companion declaration that `index.ts`'s
// re-export and `tsup`'s `dts: true` bundling both rely on for a type-safe
// `AnalyticsProvider` re-export. Keeping the canonical type here, imported by
// both `AnalyticsProvider.svelte`'s script block and the companion `.d.ts`,
// avoids two independently-drifting copies of the same shape.
export interface AnalyticsProviderProps<Events extends EventMap = EventMap> {
  analytics: Analytics<Events>;
  children?: Snippet;
}

// Reads the nearest ancestor `<AnalyticsProvider analytics={...}>`'s
// `Analytics` instance off Svelte's Context API. Throws -- rather than
// returning `undefined` or a fake no-op `Analytics` -- when no ancestor
// provider is present, so a missing provider is a loud, immediate error
// instead of a silent no-op that could go unnoticed in production. Mirrors
// every other package's `useAnalytics()` throw contract in this phase
// exactly (deliberate cross-framework naming/behavior consistency, not a
// Svelte-idiomatic `getAnalyticsContext`-style name).
//
// Runtime constraint, load-bearing: per Svelte's own rules, `getContext`
// (and therefore this function) must be called synchronously during a
// component's own initialization -- i.e. directly inside a `.svelte` file's
// `<script>` block (or a plain function invoked synchronously from there),
// never from an async callback, `setTimeout`, `onMount`, or any other
// deferred context. Calling it outside that window throws Svelte's own
// `lifecycle_outside_component`-style runtime error, a different failure
// mode from this function's own missing-provider error below.
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
  const analytics = getContext<Analytics<EventMap> | undefined>(ANALYTICS_KEY);

  if (analytics === undefined) {
    throw new Error(
      "useAnalytics() was called outside of an AnalyticsProvider. " +
        "Wrap your component tree in <AnalyticsProvider analytics={...}> " +
        "before calling useAnalytics().",
    );
  }

  return analytics as Analytics<Events>;
}
