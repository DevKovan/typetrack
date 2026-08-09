# 006 -- Plugin guide (`docs/plugins.md`)

## Context

Depends on issue 001. Independent of issues 002-005, 007-010.

## Scope of this issue

Write `docs/plugins.md`:

1. **What a plugin is**: a setup function invoked once at `createAnalytics()`
   construction time with the live `Analytics` instance, distinct from
   middleware (plugins *originate* `track()`/`page()` calls of their own;
   middleware transforms/observes events already in flight) -- cite `src/
   plugins.ts`'s own module doc comment for this exact distinction. How to
   register: `createAnalytics({ plugins: [autoPage(), autoClicks()] })`.
   Teardown: an optional returned function, invoked by `destroy()`, in
   plugin-array order, before provider flush/destroy.
2. **One subsection per built-in plugin** (all eight, from `src/
   plugins/*.ts`), each covering: what it does, the event(s) it fires (exact
   name + properties shape), its `Options` type (if any), browser-only/
   no-op-outside-browser behavior, and one real, cited code sample:
   - `autoPage()` -- History API patch + `popstate`, fires `.page()` via
     the shared `dispatchPageView()` dedup helper. Note that framework
     wrappers (Next/Remix) use their own router hooks instead of this
     plugin -- see `docs/cookbook.md`'s pageview recipe / the relevant
     framework's own package docs, not duplicated here.
   - `autoClicks(options?)` -- "Element Clicked" on `document` click,
     `selector`/`getProperties` options, auto-computed properties
     (`computeClickProperties`: tag/id/classes/text/href).
   - `autoScroll(options?)` -- "Scroll Depth Reached" at configurable
     thresholds (default `[25, 50, 75, 100]`), fires once per threshold per
     plugin lifetime.
   - `autoVisibility()` -- "Page Visibility Changed" on `visibilitychange`.
   - `autoErrors()` -- "Error Occurred" (`window` `error`) / "Unhandled
     Rejection" (`unhandledrejection`).
   - `autoWebVitals()` -- "Web Vital Measured" for FCP/LCP/CLS
     (hand-rolled via `PerformanceObserver`, not the `web-vitals` npm
     package -- state this explicitly per CLAUDE.md's zero-vendor-deps
     rule), with the `good`/`needs-improvement`/`poor` rating thresholds
     table (`WEB_VITAL_THRESHOLDS`).
   - `autoPerformance()` -- one-shot "Page Performance Measured" from the
     Navigation Timing entry (`ttfb`/`domContentLoaded`/`loadComplete`/
     `dnsMs`/`tcpMs`/`requestMs`/`responseMs`).
   - `autoUTM(options?)` -- one-shot first-touch campaign attribution,
     "Campaign Landing" event, `sessionStorage` persistence (skipped under
     `cookieless: true` -- cite the plugin's own cookieless-mode section),
     and the explicit distinction from `context: true`'s *live*
     `context.campaign` capture (different feature, same UTM-parsing
     helper `parseCampaign` under the hood) -- cite the plugin's own
     module doc comment for this exact distinction, don't restate it from
     memory.
3. **Writing a custom plugin**: the `Plugin` type signature
   (`(analytics: Analytics<any>) => (() => void) | void`), the
   **named-function-expression requirement** (`Function.prototype.name` is
   used in the setup-failure warning -- an anonymous arrow reports as
   `"<anonymous>"`, cite `src/plugins.ts`'s comment), and a short
   real-shaped example (e.g. a minimal custom plugin sketch, clearly
   labeled illustrative per BRIEF.md Design decision 3 if not copied
   verbatim from an existing plugin file).

## Testing

Documentation-only. Verify every event name/property list against the real
current plugin source (re-read each `src/plugins/*.ts` file while writing
its subsection, not from memory of earlier reads in this phase). Run `bun
run lint`, `bun run typecheck`, `bun test`, `bunx knip`.

## Out of scope

Middleware -- issue 007. Framework-specific pageview components
(`AnalyticsPageView` in `@typetrack/next`/`@typetrack/remix`) -- these are
framework-package features, not core plugins; mention only as a "see also"
pointer where `autoPage()`'s subsection notes the distinction.
