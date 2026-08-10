# PostHog provider (`@typetrack/provider-posthog`)

Two factories, sharing the same event/property translation logic
(`packages/provider-posthog/src/mapping.ts`), so both produce
byte-for-byte-equivalent output for equivalent config.

## Which one should I use?

- **`createPostHogProvider`** (SDK, `posthog-node`) — use this by default.
  Built-in client-side batching (`flushAt`/`flushInterval`), real
  `featureFlags` support (`capabilities.featureFlags: true`).
- **`createPostHogFetchProvider`** (zero-dependency, plain `fetch()`) — use
  this if you need the widest runtime support or want zero vendor SDK
  weight. It runs on Node, browsers, edge, Bun, and Deno; the SDK variant
  is verified for Node/edge/Bun/Deno but **not browsers** — `posthog-node`'s
  fallback build (what a browser bundler resolves to, absent a `browser`
  export condition) unconditionally `require()`s `node:fs` at module-load
  time.

## Install

```sh
bun add @typetrack/provider-posthog
```

## Quick start

```ts
import { createAnalytics } from "typetrack";
import { createPostHogProvider } from "@typetrack/provider-posthog";
// or: import { createPostHogFetchProvider } from "@typetrack/provider-posthog";

const analytics = createAnalytics({
  provider: createPostHogProvider({ apiKey: "phc_..." }),
});
```

## Config options

`createPostHogProvider` (`PostHogProviderConfig`):

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | |
| `host` | `string` | PostHog SDK default | |
| `flushAt` | `number` | SDK default | Client-side batch size before an automatic flush. |
| `flushInterval` | `number` | SDK default | Max time between automatic flushes. |
| `requestTimeout` | `number` | SDK default | |
| `disableGeoip` | `boolean` | SDK default | |
| `eventMap` | `Record<string, string>` | identity passthrough | Canonical → PostHog event name. |
| `propertyMap` | `{ global?; events? }` | `{}` | Canonical → PostHog property name. |

`createPostHogFetchProvider` (`PostHogFetchProviderConfig`) is a subset:
`apiKey`, `host` (default `https://us.i.posthog.com`), `eventMap`,
`propertyMap` — no `flushAt`/`flushInterval`/`requestTimeout`/
`disableGeoip` (there's no client to configure them on).

PostHog imposes no vendor-mandated event/property naming convention, so
`DEFAULT_EVENT_MAP` is an identity/passthrough table for the six shared
canonical event names ("User Signed Up" → "User Signed Up", etc.) and
`DEFAULT_PROPERTY_MAP` is empty — overriding via `eventMap`/`propertyMap`
still works, it simply starts from "no translation" rather than a vendor
table.

## Capabilities

| Capability | SDK (`createPostHogProvider`) | Fetch (`createPostHogFetchProvider`) |
|---|---|---|
| `identify` | `true` | `true` |
| `group` | `true` | `true` |
| `alias` | `true` | `true` |
| `page` | `true` | `true` |
| `screen` | `true` | `true` |
| `batching` | `true` | `false` |
| `offline` | `false` | `false` |
| `featureFlags` | `true` | `false` |
| `sessionReplay` | `false` | `false` |
| `heatmaps` | `false` | `false` |
| `batch` (drain-loop coalescing) | not declared | `true` |
| `runtimes` | `["node", "edge", "bun", "deno"]` | `["node", "browser", "edge", "bun", "deno"]` |

## Identity model

Neither variant keeps adapter-owned identity state. `distinctId` is derived
per-call from `event.userId ?? event.anonymousId`. `identify()`/`group()`/
`alias()` forward directly to PostHog's `$identify`/`$groupidentify`/
`$create_alias` (fetch variant) or SDK equivalents — nothing is cached or
"promoted" locally. `group(groupId, traits)` uses a fixed
`groupType: "group"` constant to bridge core's single-identifier verb onto
PostHog's two-identifier group model (`groupType` + `groupKey`).

## Lifecycle

SDK variant: `flush()` calls the client's own (non-terminal) `flush()`;
`destroy()` flushes then calls `shutdown()` (terminal). Fetch variant:
`flush()`/`destroy()` are both no-ops (every call already sends and awaits
its own request immediately).

## Limitations

Fetch variant has no client-side batching of its own (`batching: false`) —
it opts into core's reliability-queue-driven `trackBatch` coalescing
instead (`batch: true`), which only applies to queued (offline/retried)
events, not the normal fast path. Neither variant supports session replay
or heatmaps (both are `posthog-js` browser capture-time features with no
server/HTTP-API equivalent). Only the SDK variant declares
`featureFlags: true` — the fetch variant has no
`getFeatureFlag`/`getAllFlags`-equivalent HTTP call implemented.
