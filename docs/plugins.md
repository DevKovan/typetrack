# Plugins

## What a plugin is

A plugin is a setup function invoked **once**, at `createAnalytics()`
construction time, with the live `Analytics` instance. Unlike middleware
(which transforms/observes events already in flight), a plugin
**originates** its own `track()`/`page()` calls — e.g. listening for DOM
events and turning them into tracked events (`src/plugins.ts`'s own module
doc comment states this distinction explicitly).

```ts
import { createAnalytics, autoPage, autoClicks } from "typetrack";

const analytics = createAnalytics({
  provider,
  plugins: [autoPage(), autoClicks({ selector: "[data-track]" })],
});
```

Each plugin may return a teardown function, invoked by `destroy()` (in
plugin-array registration order, before provider flush/destroy). A plugin
that throws during setup is caught and warned, never crashes
`createAnalytics()`, and never blocks the next plugin in the array.

## Built-in plugins

All eight live under `src/plugins/`. Every one is **browser-only** — it
no-ops (attaches nothing, returns `undefined`) outside a browser
environment, and never throws.

### `autoPage(options?)`

Detects client-side URL changes (History API `pushState`/`replaceState`
patching + a `popstate` listener) and reports each as a `.page()` call, via
the shared, dedup-aware `dispatchPageView()` helper (also reused by
`@typetrack/next`/`@typetrack/remix`'s own router-aware pageview
components, which use their framework's router instead of this plugin —
see that framework's own package for accurate route detection there).

```ts
plugins: [autoPage({ getPageArgs: () => ({ name: location.pathname }) })]
```

### `autoClicks(options?)`

Fires `"Element Clicked"` on every `document` click (bubble phase), with
auto-computed properties: `tag`, `id`, `classes`, `text` (trimmed, capped
at 200 chars), `href`. `selector` restricts tracking to elements matching a
CSS selector (via `.closest()`); `getProperties(element)` adds custom
properties (caller keys win on collision).

### `autoScroll(options?)`

Fires `"Scroll Depth Reached"` at configurable percent-of-page thresholds
(default `[25, 50, 75, 100]`), each firing at most once per plugin
instance lifetime.

### `autoVisibility()`

Fires `"Page Visibility Changed"` (`{ state: document.visibilityState }`)
on every `visibilitychange` event.

### `autoErrors()`

Fires `"Error Occurred"` (`message`/`filename`/`lineno`/`colno`/`stack`) on
`window`'s `error` event, and `"Unhandled Rejection"` (`{ reason }`) on
`unhandledrejection`.

### `autoWebVitals()`

Fires `"Web Vital Measured"` (`{ name, value, rating }`) for FCP, LCP, and
CLS — **hand-rolled via `PerformanceObserver`**, not the `web-vitals` npm
package (per this repo's zero-vendor-dependency-in-core rule). Rating
thresholds:

| Vital | good | needs-improvement | poor |
|---|---|---|---|
| FCP | ≤ 1800ms | ≤ 3000ms | > 3000ms |
| LCP | ≤ 2500ms | ≤ 4000ms | > 4000ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |

FCP fires once, immediately, on the first paint entry. LCP/CLS accumulate
and report once finalized (on `visibilitychange` → `"hidden"` or
`pagehide`, whichever fires first).

### `autoPerformance()`

One-shot `"Page Performance Measured"` from the page's Navigation Timing
entry: `ttfb`, `domContentLoaded`, `loadComplete`, `dnsMs`, `tcpMs`,
`requestMs`, `responseMs`. Fires once per page load — no re-measurement on
SPA route changes (that's `autoPage()`'s concern, a distinct feature).

### `autoUTM(options?)`

One-shot **first-touch campaign attribution**: on setup, parses the five
standard UTM params from the current URL; if present, persists them to
`sessionStorage` (key configurable via `storageKey`) and fires exactly one
`"Campaign Landing"` event; on a later page load in the same session with
no UTM params of its own, does nothing further (the landing already fired).

This is **distinct** from `context: true`'s live `context.campaign`
capture, which re-parses the *current* URL on every event and doesn't
persist anything — the plugin's own module doc comment documents this
exact split: `context: true` is "what campaign is this event associated
with right now", `autoUTM()` is "what campaign brought this user here,
once, ever, this session". Under `cookieless: true`, `autoUTM()` skips its
`sessionStorage` persistence entirely (the landing event still fires) — see
[`docs/cookbook.md`](./cookbook.md#track-anonymously--go-cookieless).

## Writing a custom plugin

```ts
export type Plugin = (analytics: Analytics<any>) => (() => void) | void;
```

**Must be a named function expression**, not an anonymous arrow — the
setup-failure warning uses `Function.prototype.name` to report which
plugin threw; an anonymous arrow reports as `"<anonymous>"`.

```ts
function myPlugin(): Plugin {
  return function myPluginSetup(analytics) {
    const id = setInterval(() => analytics.track("Heartbeat", {}), 30_000);
    return function myPluginTeardown() {
      clearInterval(id);
    };
  };
}
```
