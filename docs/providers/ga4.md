# GA4 provider (`@typetrack/provider-ga4`)

`createGA4Provider` sends events directly to Google Analytics 4's
Measurement Protocol via the runtime's native `fetch` — **no vendor SDK**.

## Install

```sh
bun add @typetrack/provider-ga4
```

## Quick start

```ts
import { createAnalytics } from "typetrack";
import { createGA4Provider } from "@typetrack/provider-ga4";

const analytics = createAnalytics({
  provider: createGA4Provider({ measurementId: "G-XXXXXXX", apiSecret: "..." }),
});
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `measurementId` | `string` | required | GA4 Measurement ID. |
| `apiSecret` | `string` | required | Measurement Protocol API secret. |
| `apiHost` | `string` | `https://www.google-analytics.com` | Overridable so tests never hit real Google infrastructure. |
| `eventMap` | `Record<string, string>` | see below | Canonical event name → GA4 recommended event name; merged over the default table (your entry wins on collision). |
| `propertyMap` | `{ global?: Record<string,string>; events?: Record<string, Record<string,string>> }` | see below | Canonical property name → GA4 param name, globally and/or per event; merged over the default table. |

Default event map (`DEFAULT_EVENT_MAP`):

| Canonical name | GA4 event |
|---|---|
| `User Signed Up` | `sign_up` |
| `User Logged In` | `login` |
| `Checkout Started` | `begin_checkout` |
| `Purchase Completed` | `purchase` |
| `Product Viewed` | `view_item` |
| `Search Performed` | `search` |

Default property map (`DEFAULT_PROPERTY_MAP`): `Purchase Completed` maps
`orderId`→`transaction_id`, `total`→`value`; `Product Viewed` maps
`productId`→`item_id`, `name`→`item_name` — per GA4's own recommended
`purchase`/`view_item` params.

## Capabilities

| Capability | Value |
|---|---|
| `identify` | `true` |
| `group` | `false` |
| `alias` | `false` |
| `page` | `true` |
| `screen` | `false` |
| `batching` | `false` |
| `offline` | `false` |
| `featureFlags` | `false` |
| `sessionReplay` | `false` |
| `heatmaps` | `false` |
| `runtimes` | `["node", "browser", "edge", "bun", "deno"]` |

Every network call is a plain `fetch()` with no Node-specific globals, so
this adapter runs unmodified in every listed runtime.

## Identity model

`client_id`/`user_id` are read directly from `event.anonymousId`/
`event.userId` on every `track()`/`page()` call — the adapter keeps no
identity state of its own. `identify(userId, traits)` makes **zero network
calls** (GA4's Measurement Protocol has no standalone "set user" endpoint)
— it only caches `traits` as GA4 `user_properties`, attached to every
subsequent `track()`/`page()` request's body.

## Lifecycle

`flush()` and `destroy()` are both no-ops that resolve immediately — every
`track()`/`page()` call already dispatches and awaits its own request, so
there's no client-side queue to drain and no persistent connection to
close.

## Limitations

No `group`/`alias`/`screen` support (GA4's Measurement Protocol has no
group/alias concept, and this adapter targets web-stream events only, not
app-stream/`firebase_app_id`). No batching, offline queue, feature flags,
session replay, or heatmaps — this is a thin, direct HTTP adapter, not a
full client SDK.
