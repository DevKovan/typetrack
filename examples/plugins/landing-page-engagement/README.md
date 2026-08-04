# landing-page-engagement

Demonstrates `typetrack`'s five page/session/interaction plugins --
`autoPage()`, `autoUTM()`, `autoClicks()`, `autoScroll()`, `autoVisibility()`
-- composed together on a single, realistic marketing-landing-page session:
a visitor arrives via a campaign link, clicks the call-to-action, scrolls
through the page, switches tabs, and navigates client-side to a second
route -- then `analytics.destroy()` tears every plugin's listeners down.
See [`../site-reliability-and-vitals`](../site-reliability-and-vitals) for
the other three Phase 10 plugins (raw browser telemetry: errors, Web
Vitals, navigation performance).

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/plugins/landing-page-engagement
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/plugins/landing-page-engagement/index.ts
```

## Source

`index.ts`'s `runLandingPageEngagementFlow()` constructs one
`createAnalytics()` instance with all five plugins, in this registration
order (order matters -- see "Expected output"'s Step 2 note below for why
`autoPage()` is registered before `autoUTM()`):

```ts
const analytics = createAnalytics({
  provider,
  plugins: [
    autoPage(),
    autoUTM(),
    autoClicks({ selector: "[data-cta]" }),
    autoScroll({ thresholds: [25, 50, 100] }),
    autoVisibility(),
  ],
});
```

Since none of `window`/`navigator`/`document`/`location`/`history`/
`sessionStorage` exist in a plain Bun script, `installStubBrowser()` stubs
all of them directly on `globalThis` before `createAnalytics()` runs --
reusing the exact `Object.defineProperty(globalThis, ...)` technique
established by `src/context.test.ts` and every Phase 10 plugin's own
integration test. A hand-written `createLandingPageWarehouseProvider()`
(never a real `packages/provider-*` adapter) records every `.page()`/
`.track()` call it receives.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal,
exactly-reproducible output of `bun run index.ts` (nothing in this example
depends on any random value), or the "Explanation" section below for the
annotated version.

## Explanation

### Step 1-2 -- arrival and setup-time events

The stubbed page loads at `/landing?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale`.
Both plugins that act immediately at `createAnalytics()` construction time
fire in plugin-array registration order: `autoPage()`'s unconditional
initial `.page("/landing", { search: "?utm_source=..." })` call first
(representing the page load already in progress when the plugin was
registered), then `autoUTM()`'s one-shot `"Campaign Landing"` event
(`{ source: "newsletter", medium: "email", campaign: "spring-sale" }` --
`utm_term`/`utm_content` are simply absent from both the URL and the
delivered event).

### Step 3 -- `autoClicks({ selector: "[data-cta]" })`

A click on a `<span>` nested inside the `<a data-cta>` call-to-action button
resolves to the CTA itself via `Element.closest("[data-cta]")` -- exactly
what the `selector` option scopes clicks to -- and is tracked as
`"Element Clicked"` with the auto-computed element properties
(`tag`/`id`/`classes`/`text`/`href`). A second click on an unrelated
`<a class="nav-link">` link (no `data-cta` attribute anywhere in its
ancestor chain) produces zero events: a non-matching click is silently
ignored, not tracked with different properties.

### Step 4 -- `autoScroll({ thresholds: [25, 50, 100] })`

Three separate `scroll` events, each crossing exactly one configured
threshold. Each threshold fires exactly once, the moment the computed
scroll percentage first reaches or exceeds it -- crossing the same
threshold again (or scrolling past it toward a later one) never refires it.

### Step 5 -- `autoVisibility()`

A single `visibilitychange` to `"hidden"` (e.g. the visitor switches tabs)
is tracked as `"Page Visibility Changed"` with the current
`document.visibilityState`.

### Step 6 -- client-side navigation, no UTM params

A simulated `history.pushState` navigation to `/pricing` (empty
`location.search`). `autoPage()`'s patched `pushState` detects it and fires
a second `.page("/pricing", {})` call. `autoUTM()` does **not** re-fire --
not because some "already landed this session" check runs again, but
because `autoUTM()` is genuinely one-shot: per its own documented algorithm
(`src/plugins/autoUTM.ts`), it registers no listener of any kind after
setup, so a later client-side navigation is invisible to it by
construction. Had a *second full page load* (not a client-side navigation)
happened with no UTM params in the URL, `autoUTM()` would check
`sessionStorage` for a previously-persisted value and still correctly do
nothing further -- see `autoUTM()`'s own Production notes below.

### Step 7 -- `analytics.destroy()`

Every plugin's teardown runs, in registration order, before any provider
flush/destroy work begins. A further simulated click, scroll, and
`pushState` afterward together produce exactly zero additional provider
calls -- teardown verified end-to-end through the public API, not just at
the unit level.

## Plugins used

### `autoPage()`

- **Install/config**: exported from `typetrack`'s root barrel --
  `import { autoPage } from "typetrack"`. No required options; an optional
  `getPageArgs?: () => { name: string; props?: Record<string, unknown> }`
  overrides the default `{ name: location.pathname, props: { search } }`
  computation (this example uses the default).
- **Usage**: register it in `plugins: [...]`. It fires one initial
  `.page()` call at setup (the page load already in progress) and one more
  per detected client-side navigation (`history.pushState`/`replaceState`
  patching plus a `popstate` listener for back/forward navigation).
- **Customization**: supply `getPageArgs` to compute a different page
  name/props shape (e.g. a route-name-based scheme instead of raw
  `pathname`), or to integrate with a framework router that doesn't use the
  History API directly.
- **Limitations**: consecutive dispatches with the exact same computed
  `name`/`props` (JSON-compared) are deduped per `Analytics` instance, so a
  redundant `pushState` immediately followed by a matching `popstate` only
  delivers one `.page()` call -- by design, not a bug. Framework-specific
  routers (e.g. Next.js's App Router) are generally more accurate than
  generic History-API watching; `@typetrack/next`'s `AnalyticsPageView`
  uses its own router-driven detection instead of this plugin, sharing only
  the underlying dispatch helper.

### `autoUTM()`

- **Install/config**: `import { autoUTM } from "typetrack"`. Optional
  `storageKey?: string` overrides the default `sessionStorage` key
  (`"typetrack_first_touch_campaign"`) used for first-touch persistence.
- **Usage**: register it in `plugins: [...]`. On setup, if UTM params are
  present in the current URL, it persists them to `sessionStorage` and
  fires exactly one `"Campaign Landing"` `.track()` call. If UTM params are
  absent, it checks `sessionStorage` for an earlier-this-session
  persisted value and does nothing further either way (no event, no
  re-write).
- **Customization**: `storageKey` -- useful if an app already uses that key
  name for something else, or wants to namespace multiple `typetrack`
  instances' persisted campaigns separately.
- **Limitations**: **`autoUTM()` is not the same feature as
  `createAnalytics({ context: true })`'s live `context.campaign`
  annotation.** `autoUTM()` is one-shot first-touch persistence plus a
  single dedicated landing event, captured once per session and surviving
  navigation away from the landing URL; `context: true`'s `context.campaign`
  is live, per-event annotation read fresh from the *current* URL on every
  `track`/`page`/`screen` call, and disappears once the app navigates away
  from a URL carrying UTM params. Using one does not require the other --
  see `src/plugins/autoUTM.ts`'s header comment and Phase 10 issue 005 for
  the full split. Also: `autoUTM()` never listens for navigation events at
  all (see Step 6 above) -- a *second full page load* with no UTM params is
  the only way its no-re-fire path is exercised; a client-side navigation
  simply never invokes it again.

### `autoClicks()`

- **Install/config**: `import { autoClicks } from "typetrack"`. Optional
  `selector?: string` (a CSS selector, matched via `Element.closest()`)
  scopes tracked clicks to only elements matching it, or their descendants;
  optional `getProperties?: (element) => Record<string, unknown>` merges
  additional properties onto the auto-computed ones (caller-returned keys
  win on collision).
- **Usage**: register it in `plugins: [...]` (this example:
  `autoClicks({ selector: "[data-cta]" })`). Listens for `click` on
  `document` and reports each match as `"Element Clicked"` with
  `tag`/`id`/`classes`/`text`/`href`.
- **Customization**: `selector` to scope to specific interactive elements
  (buttons, CTAs, nav links); `getProperties` to attach app-specific
  metadata (e.g. a product ID read off a `data-*` attribute) beyond the
  five auto-computed fields.
- **Limitations**: without a `selector`, every click on *any* Element is
  tracked -- potentially noisy on a content-heavy page. `text` is truncated
  to 200 characters. A click whose `target` isn't Element-shaped (no
  `tagName`) is silently ignored, never throws.

### `autoScroll()`

- **Install/config**: `import { autoScroll } from "typetrack"`. Optional
  `thresholds?: number[]` overrides the default `[25, 50, 75, 100]`
  percent-of-page-scrolled values (this example: `[25, 50, 100]`).
- **Usage**: register it in `plugins: [...]`. Listens for `scroll` on
  `window` (passive) and reports `"Scroll Depth Reached"` once per
  configured threshold crossed.
- **Customization**: `thresholds` to track a coarser or finer-grained set
  of scroll depths, or to drop thresholds a given page doesn't care about
  (e.g. only `[50, 100]` for a short page).
- **Limitations**: each threshold fires **at most once per plugin instance
  lifetime, not once per route/page**. On a single-page app where
  `autoPage()` fires multiple page views without the `autoScroll()` plugin
  itself being torn down and re-registered, a threshold already reached on
  an earlier route will never fire again on a later one -- there is no
  built-in "reset scroll tracking on navigation" behavior.

### `autoVisibility()`

- **Install/config**: `import { autoVisibility } from "typetrack"`. No
  options.
- **Usage**: register it in `plugins: [...]`. Listens for
  `visibilitychange` on `document` and reports `"Page Visibility Changed"`
  with the current `document.visibilityState` on every change (not just
  transitions to `"hidden"`).
- **Customization**: none -- this plugin has no options. Filter/react to
  specific `state` values downstream (a middleware, or provider-side) if
  only e.g. `"hidden"` transitions matter to a given use case.
- **Limitations**: reports the raw `document.visibilityState` string
  verbatim (`"visible"`/`"hidden"`, per the Page Visibility API spec) --
  no derived "engaged time" or "time on page" computation of any kind.

## Production notes

- **Plugins are construction-time-only config.** `plugins: [...]` is read
  once, at `createAnalytics()` construction time -- there is no dynamic
  plugin-registration API (nothing analogous to `.use()` for middleware).
  Changing which plugins are active requires constructing a new `Analytics`
  instance.
- **`destroy()` tears down every plugin's listeners automatically, in
  registration order, before provider flush/destroy.** Verified end-to-end
  in Step 7 above: after `destroy()`, a further simulated scroll, click,
  and `pushState` together produce zero additional provider calls.
- **Every shipped plugin no-ops safely outside a browser environment --
  never throws.** Each one checks for `window`/`navigator` (and, per
  plugin, `document`/`history`/`addEventListener`) before doing anything;
  absent any of those, `createAnalytics({ plugins: [...] })` still
  constructs successfully with zero listeners attached and zero events
  fired. This is what makes it safe to unconditionally include these
  plugins in code that might run during server-side rendering.
- **`autoUTM()` vs. `context: true`.** These are two distinct, independently
  useful features -- see `autoUTM()`'s own "Limitations" subsection above
  for the full explanation. Using one does not require the other.
- **`autoScroll()`'s once-per-plugin-lifetime threshold-firing limitation.**
  See `autoScroll()`'s own "Limitations" subsection above -- thresholds
  never re-fire on a later route within the same plugin instance's
  lifetime, only across a genuine `destroy()`-then-reconstruct cycle.
- **`autoWebVitals()`'s FCP/LCP/CLS-only scope.** Not one of this
  example's five plugins, but worth restating here too: `autoWebVitals()`
  (see [`../site-reliability-and-vitals`](../site-reliability-and-vitals))
  hand-rolls only FCP/LCP/CLS -- no INP, no vendor `web-vitals` npm
  dependency, per `CLAUDE.md`'s "zero vendor deps in core" rule.
