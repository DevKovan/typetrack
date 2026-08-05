export { default, setupTypetrackModule, ANALYTICS_MODULE_ALIAS, type ModuleOptions, type ModuleKit } from "./module";

// Re-exported (not reimplemented) for direct-import convenience alongside
// the `useAnalytics` auto-import `module.ts`'s `setupTypetrackModule()`
// registers via `addImports` -- an app can still `import { useAnalytics }
// from "@typetrack/nuxt"` (or `"@typetrack/vue"` directly) explicitly if
// it prefers not to rely on Nuxt's auto-import scanning.
export { useAnalytics } from "@typetrack/vue";
export type { Analytics, EventMap } from "typetrack";
