// Phase 10's plugins vocabulary: this module owns only the `Plugin` type
// itself (the registration/teardown mechanism), mirroring `src/middleware.ts`
// (Phase 8) and `src/routing.ts` (Phase 7) -- a small, standalone module for
// this phase's own core type, decoupled from the individual built-in plugin
// implementations that live under `src/plugins/` (issues 002-005).
import type { Analytics } from "./index";

// A plugin is a setup function invoked once, at createAnalytics()
// construction time, with the live Analytics instance. It wires whatever
// it needs (DOM listeners, timers, ...) and may call analytics.track()/
// .page()/etc. itself. An optional returned teardown function is invoked
// by destroy() (see src/index.ts) -- return nothing if there's nothing to
// tear down (e.g. a one-shot plugin that only acts at setup time).
//
// `Analytics<any>` (not a generic `Events` parameter) is deliberate: a
// plugin is registered at `createAnalytics()` construction time before the
// concrete `Events` type parameter is fully useful to it (plugins call
// `.track()` with dynamically-computed event names/payloads at runtime, not
// statically-typed ones known ahead of time) -- mirrors how `Middleware`
// operates on `CanonicalEvent` rather than the app's typed `Events` map.
//
// Every shipped plugin factory (issues 002-005) must return a **named**
// function expression (e.g. `return function autoClicksSetup(analytics) {
// ... }`, not an anonymous arrow) -- `src/index.ts`'s setup-failure warning
// relies on `Function.prototype.name` to identify which plugin threw, and an
// anonymous arrow would report as `"<anonymous>"`.
export type Plugin = (analytics: Analytics<any>) => (() => void) | void;
