# context-capture

Demonstrates Phase 9's opt-in automatic environment/session context capture:
`createAnalytics({ context: true })` (or `{ context: { autoCapture: true,
featureFlags } }`). One coherent flow simulates a real page load in a
stubbed browser -- the full auto-captured `context` shape, `context.session
.eventCount` incrementing across calls, the caller-wins merge/precedence
rule, and the app-owned `featureFlags` getter -- and then, critically, the
same config run with no browser present at all (a plain server/Node/Bun
process), showing the safe-no-op guarantee this feature depends on.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/core/context-capture
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/core/context-capture/index.ts
```

## Source

Since real `window`/`navigator`/`document`/`location` globals don't exist in
a plain Bun script, `index.ts` simulates a "real page load" by stubbing
those globals (the exact same `Object.defineProperty(globalThis, ...)`
technique `src/context.test.ts` already established) before calling into
`typetrack`:

```ts
stubBrowserGlobals({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  language: "en-US",
  innerWidth: 1440,
  innerHeight: 900,
  referrer: "https://www.google.com/search?q=typetrack+analytics",
  search: "?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
});

const analytics = createAnalytics({ context: true, provider });

await analytics.page("Home");
await analytics.track("Checkout Started", { plan: "pro" });
await analytics.track("Signup Completed", { plan: "pro" }, { context: { locale: "fr-FR" } });
```

Then a second instance, still in the same stubbed browser, demonstrates the
app-owned `featureFlags` getter:

```ts
const flaggedAnalytics = createAnalytics({
  context: {
    autoCapture: true,
    featureFlags: () => ({ betaCheckout: true, newPricing: "variant-b" }),
  },
  provider,
});

await flaggedAnalytics.page("Pricing");
```

And finally, the same `context: true` config with no browser globals stubbed
at all:

```ts
clearBrowserGlobals();

const serverAnalytics = createAnalytics({ context: true, provider });
await serverAnalytics.track("Checkout Started", { plan: "pro" });
```

Every call above goes through a hand-written `AnalyticsProvider` stub
(`createRecordingProvider`) that just records each `CanonicalEvent`, so the
example's own output is exactly what `typetrack` produced -- nothing here is
a hand-authored transcript.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
output, or the "Explanation" section immediately below for the annotated
version.

## Explanation

**The full auto-captured shape** (`page("Home")`, the first block): with
both `context: true` and a stubbed browser present, every field of
`CapturedContext` is populated:

- **`locale`**/**`timezone`**: `"en-US"` (from the stubbed
  `navigator.language`) and the machine's IANA zone (via `Intl`,
  unconditionally captured whether or not a browser is present).
- **`browser`**/**`os`**/**`device`**: parsed from the stubbed
  `navigator.userAgent` by `src/context.ts`'s small, best-effort,
  regex-based UA parser -- `{ name: "Chrome", version: "124.0.0.0" }`,
  `{ name: "macOS", version: "10.15.7" }`, `{ type: "desktop" }`.
- **`viewport`**: `{ width: 1440, height: 900 }`, read live from the
  stubbed `window.innerWidth`/`innerHeight`.
- **`referrer`**: the stubbed `document.referrer`, verbatim.
- **`campaign`**: the three UTM params present in the stubbed
  `location.search` (`utm_source`/`utm_medium`/`utm_campaign`) --
  `utm_term`/`utm_content` are absent from the query string and so are
  absent from `campaign` too, not empty-string keys.
- **`session`**: `{ startedAt, eventCount: 1, durationMs }` -- this
  instance's first event.

**`session.eventCount` incrementing** (the next two blocks, same instance):
the second call's `session.eventCount` is `2`, the third's is `3` -- all
three calls share one `createAnalytics()` instance and therefore one
session.

**Caller-wins merge/precedence** (the third block,
`track("Signup Completed", ..., { context: { locale: "fr-FR" } })`):
`context.locale` is `"fr-FR"` -- the caller's explicit value -- while every
other auto-captured field (`timezone`, `browser`, `os`, `device`,
`viewport`, `referrer`, `campaign`, `session`) is still present, untouched.
The merge is a shallow `{ ...auto, ...callerSupplied }`: only the exact keys
the caller supplies are overwritten.

**The `featureFlags` getter** (the fourth block, `page("Pricing")`):
`context.featureFlags` is exactly `{ betaCheckout: true, newPricing:
"variant-b" }` -- the getter's return value, mirrored verbatim. `typetrack`
never evaluates or fetches flags itself; it only calls whatever getter the
app supplied, fresh, on every `track`/`page`/`screen` call.

**The safe-no-op guarantee** (the fifth and final block, no browser
stubbed): `context.locale`/`context.timezone`/`context.session` are still
present (`locale`/`timezone` via `Intl`, unconditional; `session` is core's
own bookkeeping, independent of any browser). But `browser`, `os`, `device`,
`viewport`, `referrer`, `campaign`, and `featureFlags` are all *absent
entirely* -- not present as `undefined`-valued keys, genuinely missing keys
-- because `isBrowserEnvironment()` returns `false` for the whole lifetime
of that instance, and no `featureFlags` getter was configured for it. This
is the single most important thing this example demonstrates: an app that
opts into `context: true` and runs server-side (or in any environment
without `window`/`navigator`) gets exactly this reduced, still-useful shape,
never a thrown error and never a browser-shaped object full of garbage
values.

## Production notes

- **`context: true` is opt-in and off by default.** Existing apps that never
  set the `context` option see zero behavior change -- `CanonicalEvent
  .context` remains exactly whatever `TrackOptions.context` they supplied
  (or `undefined`), with no `Intl`/UA work performed at all.
- **The merge rule is caller-wins, shallow, not deep.** A caller-supplied
  `TrackOptions.context` key always overwrites the auto-captured value for
  that exact key; it does not recursively merge nested objects (e.g.
  supplying `{ context: { browser: { name: "MyWebView" } } }` replaces the
  entire auto-captured `browser` object, it does not merge `name` into the
  parsed one).
- **The safe-no-op guarantee is what makes this safe to enable
  unconditionally in isomorphic code.** Server-side (SSR, API routes, batch
  jobs, ...), the browser-only fields are simply absent --
  `locale`/`timezone`/`session` still populate every event, everything else
  quietly stays out of the way.
- **`featureFlags` is app-owned.** `typetrack` never evaluates, fetches, or
  caches feature flags itself -- it only calls the supplied getter, fresh,
  on every `track`/`page`/`screen` call, and mirrors whatever it returns
  (verbatim, no validation) into `context.featureFlags`. A getter that
  throws simply results in `featureFlags` being omitted for that one call,
  not a thrown error out of `track()`/`page()`/`screen()`.
- **UA parsing is best-effort, not exhaustive.** `src/context.ts`'s
  `parseUserAgent` is a small, hand-rolled, regex-based heuristic (no vendor
  dependency, per this repo's zero-vendor-deps-in-core rule) covering the
  major browsers/OSes/device types. Don't rely on it for precise
  browser/OS version detection in analytics dashboards that need that level
  of accuracy -- for that, capture the raw `navigator.userAgent` yourself
  (e.g. via `TrackOptions.context`) and parse it with a dedicated library
  downstream.
