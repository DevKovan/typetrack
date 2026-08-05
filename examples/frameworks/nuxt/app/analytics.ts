// App-authored: `@typetrack/nuxt`'s generated runtime plugin performs a
// static `import analytics from "#typetrack/analytics-module"` (an alias
// `../nuxt.config.ts`'s `typetrack.analyticsModule` option points at this
// exact file) -- so this file's **default export** must be a real,
// pre-constructed `Analytics` instance, not a factory function. Constructed
// once, shared by both the server and client runtime (see
// `packages/nuxt/src/module.ts`'s own header comment for the full
// "config-time/runtime-boundary" reasoning this pattern exists for).
import { createAnalytics } from "typetrack";
import { createGA4Provider } from "@typetrack/provider-ga4";

export default createAnalytics({
  provider: createGA4Provider({
    measurementId: process.env.NUXT_PUBLIC_GA4_MEASUREMENT_ID!,
    apiSecret: process.env.NUXT_PUBLIC_GA4_API_SECRET!,
  }),
});
