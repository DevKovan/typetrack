import type { App } from "vue";
import { typetrackPlugin } from "@typetrack/vue";
import type { Analytics, EventMap } from "typetrack";

// The core, directly-testable logic behind `runtime/plugin.ts`'s
// `defineNuxtPlugin` callback: installs issue 001's `typetrackPlugin`
// (`app.provide(analyticsKey, analytics)`, via `app.use(...)`) onto a Vue
// `App` instance. Factored into its own plain function, taking `analytics`
// as an explicit parameter, specifically so it's testable against a real
// `@vue/test-utils` app independent of `runtime/plugin.ts`'s own static
// `import analytics from "#typetrack/analytics-module"` -- that alias only
// resolves inside a real Nuxt build (see `../module.ts`'s header comment),
// so `runtime/plugin.ts` itself cannot be imported directly from a plain
// `bun test` process; this function can.
export function installTypetrackPlugin<Events extends EventMap = EventMap>(
  vueApp: App,
  analytics: Analytics<Events>,
): void {
  vueApp.use(typetrackPlugin, { analytics: analytics as Analytics<EventMap> });
}
