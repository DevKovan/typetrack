// App-authored: `@typetrack/astro`'s `injectScript`-generated code performs
// a static `import analytics from "/src/lib/analytics.ts"` (the literal
// specifier `../astro.config.mjs`'s `typetrackAstro({ analyticsModule })`
// option names) -- so this file's **default export** must be a real,
// pre-constructed `Analytics` instance. Processed and resolved by Astro's
// own Vite pipeline at build time, exactly like any other client-side
// import in an Astro project (`injectScript`'s `"page"` stage is
// Vite-processed).
import { createAnalytics } from "typetrack";
import { createGA4Provider } from "@typetrack/provider-ga4";

export default createAnalytics({
  provider: createGA4Provider({
    measurementId: import.meta.env.PUBLIC_GA4_MEASUREMENT_ID,
    apiSecret: import.meta.env.PUBLIC_GA4_API_SECRET,
  }),
});
