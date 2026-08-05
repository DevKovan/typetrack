import { defineNuxtPlugin, useRouter } from "nuxt/app";
// See `./plugin.ts`'s header comment for the full "config-time/runtime-
// boundary" reasoning behind this static import -- only resolves inside a
// real Nuxt build.
import analytics from "#typetrack/analytics-module";
import { registerPageViewTracking } from "./registerPageViewTracking";

// `.client.ts` filename suffix: Nuxt's own build-time mechanism for
// excluding this file from the server bundle entirely (a real, build-time
// exclusion, not a runtime `if` check) -- a server-rendered request has no
// "route change" concept (it renders exactly once per request), so this
// plugin is genuinely client-only, per this issue's plan doc "SSR-safety"
// section. `registerPageViewTracking` (the actual dispatch/dedup logic)
// is factored out into its own module specifically so it's testable
// without this file's own static alias import or a real `useRouter()` --
// see `./registerPageViewTracking.ts` and its test file.
export default defineNuxtPlugin(() => {
  const router = useRouter();
  registerPageViewTracking(analytics, router);
});
