# Segment provider (`@typetrack/provider-segment`)

Two factories, sharing the same event/property translation logic
(`packages/provider-segment/src/mapping.ts`).

## Which one should I use?

- **`createSegmentProvider`** (SDK, `@segment/analytics-node`) — use this
  by default. Built-in client-side batching.
- **`createSegmentFetchProvider`** (zero-dependency, plain `fetch()` +
  HTTP Basic Auth) — use this for edge/browser runtimes. The SDK variant is
  only verified for Node/Bun/Deno (`runtimes: ["node", "bun", "deno"]`) —
  `@segment/analytics-node` declares no `exports` field at all (every
  runtime resolves the same Node-oriented build), and its transitive
  `@lukeed/csprng` dependency resolves to a `node:crypto`-based build under
  a plain, conditionless import — not verified safe in a browser bundle or
  edge runtime. The fetch variant has no such dependency and runs
  everywhere `fetch`/`btoa` exist.

## Install

```sh
bun add @typetrack/provider-segment
```

## Quick start

```ts
import { createAnalytics } from "typetrack";
import { createSegmentProvider } from "@typetrack/provider-segment";
// or: import { createSegmentFetchProvider } from "@typetrack/provider-segment";

const analytics = createAnalytics({
  provider: createSegmentProvider({ writeKey: "..." }),
});
```

## Config options

`createSegmentProvider` (`SegmentProviderConfig`):

| Option | Type | Default | Description |
|---|---|---|---|
| `writeKey` | `string` | required | |
| `host` | `string` | SDK default | |
| `path` | `string` | SDK default | |
| `maxEventsInBatch` | `number` | SDK default | Client-side batch size. |
| `flushInterval` | `number` | SDK default | |
| `eventMap` | `Record<string, string>` | see `mapping.ts` defaults | |
| `propertyMap` | `{ global?; events? }` | see `mapping.ts` defaults | |

`createSegmentFetchProvider` (`SegmentFetchProviderConfig`) is a subset:
`writeKey`, `host` (default `https://api.segment.io`), `eventMap`,
`propertyMap` — no `path`/`maxEventsInBatch`/`flushInterval` (there's no
client-side batching queue to configure).

The fetch variant authenticates via HTTP Basic Auth (`Authorization: Basic
base64(writeKey + ":")`, via `btoa` — never Node's `Buffer`, so it stays
usable in every runtime `fetch` reaches) and calls six distinct endpoints
directly: `/v1/track`, `/v1/page`, `/v1/screen`, `/v1/identify`,
`/v1/group`, `/v1/alias`. `/v1/batch` is deliberately out of scope for this
adapter.

## Capabilities

| Capability | SDK (`createSegmentProvider`) | Fetch (`createSegmentFetchProvider`) |
|---|---|---|
| `identify` | `true` | `true` |
| `group` | `true` | `true` |
| `alias` | `true` | `true` |
| `page` | `true` | `true` |
| `screen` | `true` | `true` |
| `batching` | `true` | `false` |
| `offline` | `false` | `false` |
| `featureFlags` | `false` | `false` |
| `sessionReplay` | `false` | `false` |
| `heatmaps` | `false` | `false` |
| `runtimes` | `["node", "bun", "deno"]` | `["node", "browser", "edge", "bun", "deno"]` |

## Identity model

Neither variant caches identity state — every `track()`/`page()`/
`screen()` call derives `userId`/`anonymousId` directly from the
`CanonicalEvent` it's given. `identify()`/`group()`/`alias()` forward their
arguments as-is.

## Lifecycle — read this before calling `flush()`

Verified directly against `@segment/analytics-node`'s type declarations and
compiled implementation: the SDK client exposes a genuinely **non-terminal**
`flush({ close: false })`, separate from the terminal `closeAndFlush()`.

- `analytics.flush()` → the adapter's non-terminal `flush()` — **the
  instance stays usable afterward.**
- `analytics.destroy()` → flush, then the terminal `closeAndFlush()`
  (SDK variant) or a plain no-op (fetch variant, which has no client-side
  queue or connection to close).

This is a deliberate, documented design point in `packages/
provider-segment/src/index.ts` — an earlier version of this adapter had
`flush()` mapped to the terminal operation, which was a bug; treat this
distinction as the important thing to get right if you're writing your own
`AnalyticsProvider` and modeling it after Segment's SDK.

## Limitations

No `featureFlags`/`sessionReplay`/`heatmaps`/`offline` support in either
variant. Fetch variant has no client-side batching (`batching: false`) and
no `/v1/batch` support at all — every call is its own immediate request.
