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

analytics.track("signup_completed", { plan: "pro" });
```

Pass a `provider` to send events to a real backend instead of the built-in
no-op:

```ts
import { createAnalytics, type AnalyticsProvider } from "typetrack";

const myProvider: AnalyticsProvider = {
  name: "my-provider",
  track(event, payload, meta) {
    console.log(event, payload, meta);
  },
};

const analytics = createAnalytics({ provider: myProvider });
```

Provider adapters for specific vendors (PostHog, Segment, GA4, ...) ship as
separate `@typetrack/provider-*` packages under `packages/`.

## Building from source

This is a Bun workspaces monorepo (root `typetrack` package plus
`packages/*`). From a clean checkout:

```sh
bun install      # install deps for every workspace package
bun run build:all  # build every package, in dependency order (root, then
                    # packages/react, then packages/next)
bun test          # run the full test suite across the monorepo
```

`bun run build:all` is the one command that builds every package in this
monorepo — there is no need to `cd` into individual packages or run builds
in any particular manual order yourself.

## Status

Early scaffold — see `plan/` for the phased build-out.
