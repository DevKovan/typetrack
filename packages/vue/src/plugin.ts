import type { App, InjectionKey, Plugin } from "vue";
import type { Analytics, EventMap } from "typetrack";

// A real, unique `Symbol`-backed key, typed via Vue's own `InjectionKey<T>`
// generic so `provide()`/`inject()` stay in sync on the value type without
// either side re-declaring it (Vue's own documented, current convention for
// type-safe DI). Exported (not just used internally) so `@typetrack/nuxt`
// can `provide()` onto this exact same key from its own generated runtime
// plugin and have this package's `useAnalytics()` keep working unmodified.
export const analyticsKey: InjectionKey<Analytics<EventMap>> = Symbol(
  "typetrack-analytics",
) as InjectionKey<Analytics<EventMap>>;

export interface AnalyticsPluginOptions<Events extends EventMap = EventMap> {
  analytics: Analytics<Events>;
}

// Vue's idiomatic pattern for sharing a non-reactive singleton service: a
// plugin (an object with `install(app, options)`) that calls
// `app.provide(key, value)` at the app level, installed via
// `app.use(typetrackPlugin, { analytics })` -- the second argument to
// `app.use()` is forwarded verbatim to `install()` as Vue's own documented
// plugin-options convention. Paired with `useAnalytics()` (see
// `useAnalytics.ts`), this is the Vue-idiomatic analogue of
// `@typetrack/react`'s `AnalyticsProvider` component + `useAnalytics()` hook
// pair -- but no component/SFC is needed at all, since `provide`/`inject`
// are plain Composition-API function calls.
export const typetrackPlugin: Plugin<[AnalyticsPluginOptions]> = {
  install(app: App, options: AnalyticsPluginOptions) {
    app.provide(analyticsKey, options.analytics as Analytics<EventMap>);
  },
};
