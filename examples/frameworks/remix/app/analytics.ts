// A plain module-level singleton -- unlike `@typetrack/nuxt`/
// `@typetrack/astro` (which need an `analyticsModule` *specifier*, resolved
// across a config-time/browser-bundle boundary neither of them can pass a
// live object across), `@typetrack/remix` has no such constraint:
// React Router v8's default framework mode has no Server/Client Component
// split (see `plan/phase-14-framework-wrappers/BRIEF.md`'s Design decision
// 7), so the app author constructs the `Analytics` instance directly and
// renders `<AnalyticsProvider>` themselves, exactly like a plain
// `@typetrack/react` app would -- `app/root.tsx` imports this module
// directly.
import { createAnalytics } from "typetrack";
import { createGA4Provider } from "@typetrack/provider-ga4";

export const analytics = createAnalytics({
  provider: createGA4Provider({
    measurementId: import.meta.env.VITE_GA4_MEASUREMENT_ID,
    apiSecret: import.meta.env.VITE_GA4_API_SECRET,
  }),
});
