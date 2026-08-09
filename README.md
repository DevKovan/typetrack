# typetrack

Typed, zero-runtime-cost analytics SDK.

## Install

```sh
bun add typetrack
```

## Usage

```ts
import { createAnalytics } from "typetrack";

const analytics = createAnalytics();

analytics.track("Signup Completed", { plan: "pro" });
```

Pass a `provider` to send events to a real backend instead of the built-in
no-op. Every provider implements the same `AnalyticsProvider` interface and
receives one canonical `CanonicalEvent` argument per call — application
code never changes when you swap providers:

```ts
import { createAnalytics, type AnalyticsProvider, type CanonicalEvent } from "typetrack";

const myProvider: AnalyticsProvider = {
  name: "my-provider",
  capabilities: {
    identify: false, group: false, alias: false, page: false, screen: false,
    batching: false, offline: false, featureFlags: false, sessionReplay: false,
    heatmaps: false,
  },
  track(event: CanonicalEvent) {
    console.log(event.name, event.properties, event.timestamp);
  },
};

const analytics = createAnalytics({ provider: myProvider });
```

Provider adapters for specific vendors (PostHog, Segment, GA4, ...) ship as
separate `@typetrack/provider-*` packages under `packages/`.

## Documentation

See [`docs/README.md`](./docs/README.md) for the full guide index —
architecture, cookbook, migration, per-provider reference, plugins,
middleware, performance, comparison pages, and FAQ.

## Building from source

This is a Bun workspaces monorepo (root `typetrack` package plus
`packages/*`). From a clean checkout:

```sh
bun install       # install deps for every workspace package
bun run build:all # build every package, in dependency order (root, then
                   # packages/react, next, vue, nuxt, svelte, solid, astro,
                   # remix)
bun test          # run the full test suite across the monorepo
```

`bun run build:all` is the one command that builds every package in this
monorepo — there is no need to `cd` into individual packages or run builds
in any particular manual order yourself.

`bun run size` checks gzip bundle size of the tracked `dist/` artifacts
(root `.size-limit.json`) against fixed limits, via `size-limit`/
`@size-limit/file`. It requires `bun run build:all` to have already run —
it checks already-built files, it does not build them itself.

## Status

Pre-1.0, not yet published to npm. Phases 0-16 have landed (canonical event
model, multi-provider routing, middleware, context auto-capture, plugins,
privacy/consent, reliability/offline queue, runtime-agnostic adapters,
remaining framework wrappers, validation hardening, testing infrastructure)
— see `plan/ROADMAP.md` for what's landed and what's next, and `plan/
CHANGELOG.md` for the full per-phase history.
