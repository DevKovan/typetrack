# 001 — `Plugin` type, `plugins` registration option, and `destroy()` teardown wiring

## Context

New `src/plugins.ts` module — the Phase 10 analog of `src/middleware.ts`
(Phase 8) and `src/routing.ts` (Phase 7): a dedicated, standalone module
that defines this phase's own core vocabulary, kept separate from the
individual plugin *implementations* (which live under `src/plugins/`,
added by issues 002-005, mirroring how `src/middleware/redact.ts` etc. sit
alongside `src/middleware.ts`).

This issue implements the locked design from this phase's grill-me
interview exactly — do not relitigate:

- **Plugin shape**: a plugin is a bare function, not an object (unlike
  `Middleware`):

  ```ts
  export type Plugin = (analytics: Analytics<any>) => (() => void) | void;
  ```

  Called once, at `createAnalytics()` construction time, with the live,
  fully-constructed `Analytics` instance. It wires up whatever it needs
  (DOM listeners, timers, etc.) and may call `analytics.track()`/`.page()`/
  etc. itself. An optional returned function is the plugin's teardown;
  returning nothing (`undefined`) means the plugin has nothing to clean up
  (e.g. a one-shot plugin that only fires once at setup, like Phase 10's
  `autoUTM`).

- **Registration point, distinct from `.use()`**: a `plugins?: Plugin[]`
  option on `CreateAnalyticsOptions`, auto-invoked once at construction —
  not a separate `analytics.plugin()` runtime method. This keeps `.use()`
  (Phase 8, middleware, transforms/observes events already in flight) and
  plugin registration (this phase, plugins originate new track calls)
  visibly distinct surfaces that never collide.

- **Teardown ownership**: `destroy()` calls every registered plugin's
  returned teardown function, in registration order, **before** the
  existing provider flush+destroy logic (issue rationale: stop plugins
  from generating new `track()`/`page()` calls before providers start
  draining/tearing down — avoids a plugin firing into a provider that's
  mid-teardown). A teardown that throws is swallowed and reported via
  `console.warn` (same pattern as the rest of `src/index.ts`'s
  swallow-and-warn conventions) — it does **not** join `destroy()`'s
  existing `AggregateError`, and it never prevents the remaining
  teardowns or the provider flush+destroy phases from running.

- **Runtime safety**: `isBrowserEnvironment()` (`src/context.ts`, Phase 9)
  is re-exported from the package's public barrel (`src/index.ts`) so
  plugin authors — including this phase's own built-ins (issues 002-005)
  and third-party plugins — can gate browser-only logic without
  reinventing feature detection. This issue does not itself add any
  browser-only logic; it only wires the registration/teardown mechanism
  and the re-export.

## Scope of this issue

This issue owns the **registration and teardown mechanism only** — no
actual plugin implementations (`autoPage`, `autoClicks`, etc. are issues
002-005).

`src/plugins.ts` exports:

```ts
import type { Analytics } from "./index";

// A plugin is a setup function invoked once, at createAnalytics()
// construction time, with the live Analytics instance. It wires whatever
// it needs (DOM listeners, timers, ...) and may call analytics.track()/
// .page()/etc. itself. An optional returned teardown function is invoked
// by destroy() (see src/index.ts) -- return nothing if there's nothing to
// tear down (e.g. a one-shot plugin that only acts at setup time).
export type Plugin = (analytics: Analytics<any>) => (() => void) | void;
```

`Analytics<any>` (not a generic `Events` parameter) is deliberate: a
plugin is registered at `createAnalytics()` construction time before the
concrete `Events` type parameter is fully useful to it (plugins call
`.track()` with dynamically-computed event names/payloads at runtime, not
statically-typed ones known ahead of time) — mirrors how `Middleware`
operates on `CanonicalEvent` rather than the app's typed `Events` map.

Also update `src/index.ts`:

- Add `plugins?: Plugin[];` to `CreateAnalyticsOptions<Events>` (doc
  comment: invoked once, in array order, at construction; each plugin's
  returned teardown — if any — is called by `destroy()`).
- Re-export `Plugin` as a type from the public barrel: `export type {
  Plugin } from "./plugins";` (alongside the existing `Middleware`
  re-export).
- Re-export `isBrowserEnvironment` from `./context`: `export {
  isBrowserEnvironment } from "./context";` (alongside the existing
  `CapturedContext`/`ContextOptions` type re-exports).
- **Restructure `createAnalytics()`'s return so plugins can receive the
  live instance.** Today the function ends with a bare `return { track()
  {...}, ..., use() {...} };` object literal. That must become:

  ```ts
  const analytics: Analytics<Events> = {
    track(...) { ... },
    // ...every existing verb, unchanged...
    use(middleware) { middlewares.push(middleware); },
  };

  const pluginTeardowns: (() => void)[] = [];
  for (const plugin of options.plugins ?? []) {
    try {
      const teardown = plugin(analytics);
      if (teardown) pluginTeardowns.push(teardown);
    } catch (error) {
      console.warn(`typetrack: plugin "${plugin.name || "<anonymous>"}" threw during setup -- ${error}`);
    }
  }

  return analytics;
  ```

  `plugin.name` relies on JS's `Function.prototype.name` — every shipped
  plugin factory (issues 002-005) must return a **named** function
  expression (e.g. `return function autoClicksSetup(analytics) { ... }`,
  not an anonymous arrow) specifically so this warning is legible; note
  this requirement inline as a comment for future plugin authors.
- Add a `pluginTeardowns` walk to the front of `destroy()`, before its
  existing flush/destroy logic (both the single-provider and multi-provider
  branches):

  ```ts
  async destroy() {
    for (const teardown of pluginTeardowns) {
      try {
        teardown();
      } catch (error) {
        console.warn(`typetrack: a plugin's teardown threw during destroy() -- ${error}`);
      }
    }
    // ...existing flush+destroy logic, unchanged...
  }
  ```

  (Plugin teardowns have no `provider.name`-style identifier to include in
  the warning the way `callSingleProvider`/`dispatchToProviders` do — a
  plain message naming the failure is sufficient; do not attempt to thread
  a plugin name through here beyond what's cheaply available.)

## Design decisions made in this issue (narrow implementation gaps, not open architecture questions)

- **Where `Plugin` lives**: `src/plugins.ts`, mirroring `src/middleware.ts`'s
  precedent — a small, standalone module for this phase's own core type,
  decoupled from the individual built-in plugin implementations that will
  live under `src/plugins/`.
- **Plugin setup errors are swallowed, not propagated**: a throwing
  `plugin()` call must not prevent `createAnalytics()` from returning a
  working `Analytics` instance, nor prevent later plugins in the array
  from running. Mirrors the "never throw" contract established by Phase 9's
  context capture and Phase 8's middleware `onError` handling.
- **No dynamic `analytics.plugin()` registration method**: deliberately
  out of scope per the locked design — plugins are construction-time
  config only, for v1.

## Acceptance criteria

- `src/plugins.ts` exists, exports exactly `Plugin` (the type above).
- `CreateAnalyticsOptions<Events>.plugins?: Plugin[]` is present and
  documented.
- `Plugin` is exported as a type from the package's public entry point.
- `isBrowserEnvironment` is exported (value, not type-only) from the
  package's public entry point.
- `createAnalytics({ plugins: [p1, p2] })` calls `p1` then `p2`, each with
  the same, fully-constructed `Analytics` instance (assert via a spy that
  records the argument it was called with, and assert that instance's
  `.track`/`.page`/etc. methods are callable from inside the plugin at
  setup time — i.e. the instance is not partially constructed).
- A plugin returning a teardown function has that function invoked exactly
  once when `.destroy()` is called; a plugin returning `undefined` — no
  teardown call attempted for it.
- Teardowns run in registration order, and run to completion (every
  teardown is attempted even if an earlier one throws) before the existing
  provider flush/destroy logic begins.
- A throwing plugin setup does not prevent `createAnalytics()` from
  returning, nor prevent subsequent plugins in the array from running
  (assert via call-count on a later plugin in the array after an earlier
  one throws).
- A throwing plugin teardown does not prevent later teardowns or the
  provider flush/destroy logic from running; `destroy()` still resolves
  (does not reject) purely because of a plugin teardown failure — provider
  failures still produce the existing `AggregateError` behavior, unchanged.
- No `plugins` option (or `plugins: []`) — zero behavior change from
  pre-Phase-10 (no extra work performed, `destroy()`'s existing behavior
  byte-for-byte unchanged).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/plugins.test.ts`): minimal — the `Plugin` type itself
has no runtime logic to unit test in isolation; a short test file
asserting the type is usable (a plugin implementing the shape compiles and
can be invoked) is sufficient, or this can be folded entirely into the
integration tests below if a standalone unit test file would be vacuous —
implementor's call, document whichever you pick.

**Integration tests** (folded into `src/index.test.ts`, a new `describe`
block):

- Construct `createAnalytics({ plugins: [...] })` with 2-3 spy-based
  plugins (some returning a teardown, some not, one throwing at setup) —
  assert setup call order, that each receives the live instance, that a
  throw in one doesn't block the others.
- Call `.destroy()` and assert teardown call order, that a throwing
  teardown doesn't block the remaining teardowns or provider
  flush/destroy, and that teardowns run before a spy `provider.flush`/
  `provider.destroy` are invoked (assert via a shared ordering array both
  the plugin teardowns and the stub provider's `flush`/`destroy` push
  into).
- No-`plugins`-option regression check: `track()`/`destroy()` behave
  exactly as before this issue.

## Out of scope

- Any actual plugin implementation (`autoPage`, `autoClicks`,
  `autoErrors`, `autoWebVitals`, `autoPerformance`, `autoScroll`,
  `autoVisibility`, `autoUTM`) — issues 002-005.
- `@typetrack/next` changes — issue 006.
- `examples/plugins/` — issue 007.
