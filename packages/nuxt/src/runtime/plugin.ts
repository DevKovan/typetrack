import { defineNuxtPlugin } from "nuxt/app";
// The statically-imported, app-supplied `Analytics` instance -- resolves
// only inside a real Nuxt build, via the `#typetrack/analytics-module`
// alias `../module.ts`'s `setupTypetrackModule()` registers (see that
// file's header comment for the full "config-time/runtime-boundary"
// reasoning; see `./analytics-module.d.ts` for why this still type-checks
// under a plain `bun run typecheck` with no real Nuxt build present).
// This import is the one line of this package a real `nuxi build`/
// `nuxi dev` pass is required to actually exercise end-to-end -- see this
// issue's plan doc's documented testing limitation, and
// `./installTypetrackPlugin.test.ts` for the factored-out logic this file
// delegates to, which *is* covered by an automated integration test.
import analytics from "#typetrack/analytics-module";
import { installTypetrackPlugin } from "./installTypetrackPlugin";

// Runs identically on server and client (no `.client`/`.server` suffix) --
// `app.provide()` itself is not browser-dependent, per this issue's plan
// doc "SSR-safety" section.
export default defineNuxtPlugin((nuxtApp) => {
  installTypetrackPlugin(nuxtApp.vueApp, analytics);
});
