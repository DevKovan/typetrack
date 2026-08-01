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

## Status

Early scaffold — see `plan/` for the phased build-out.
