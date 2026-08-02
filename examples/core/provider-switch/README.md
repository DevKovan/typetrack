# provider-switch

Demonstrates the Golden Rule from `plan/VISION.md`: an app built against
`typetrack` switches analytics providers by editing the one file that
constructs `createAnalytics()` -- never the application code, event names,
or payloads.

## Prerequisites

- Bun installed.
- Run from the *monorepo root* first: `bun install` (this example depends
  on the local, in-repo `typetrack` and `@typetrack/provider-ga4` packages
  via `file:../../..` / `workspace:*`, not published npm versions).

## How to run

```sh
cd examples/core/provider-switch

# Safe: noopProvider accepts every call and does nothing.
bun run run-with-noop.ts

# Safe: a real createGA4Provider, but pointed at a local Bun.serve() stub
# instead of real Google infrastructure.
bun run run-with-ga4-local-stub.ts

# UNSAFE as-is: issues real HTTP requests to Google's live Measurement
# Protocol endpoint (with placeholder credentials, so Google will reject
# them, but the network request still happens). Read its file header
# before running it.
bun run run-with-ga4.ts
```

## Source

`app.ts` is the shared, provider-agnostic business logic -- a checkout
flow -- written once:

```ts
export async function runCheckoutFlow(provider: AnalyticsProvider): Promise<void> {
  const analytics = createAnalytics({ provider });

  const items: CartItem[] = [
    { id: "sku_1", name: "Wireless Mouse", price: 29.99, quantity: 1 },
    { id: "sku_2", name: "Mechanical Keyboard", price: 89.99, quantity: 1 },
  ];

  await analytics.identify("user_42", { email: "ada@example.com", plan: "pro" });
  await analytics.track("Checkout Started", buildCheckoutStartedPayload(items));
  await analytics.track("Purchase Completed", buildPurchaseCompletedPayload("order_9001", items));

  await analytics.flush();
  await analytics.destroy();
}
```

Each entry point calls `runCheckoutFlow`, differing only in which provider
they construct:

```ts
// run-with-noop.ts
import { noopProvider } from "typetrack";
import { runCheckoutFlow } from "./app";
await runCheckoutFlow(noopProvider);
```

```ts
// run-with-ga4.ts
import { createGA4Provider } from "@typetrack/provider-ga4";
import { runCheckoutFlow } from "./app";
const provider = createGA4Provider({
  measurementId: "G-XXXXXXXXXX",
  apiSecret: "REPLACE_WITH_ENV_VAR",
});
await runCheckoutFlow(provider);
```

```ts
// run-with-ga4-local-stub.ts
import { createGA4Provider } from "@typetrack/provider-ga4";
import { runCheckoutFlow } from "./app";
import { startGA4Stub } from "./ga4-stub-server";

const stub = startGA4Stub();
const provider = createGA4Provider({
  measurementId: "G-XXXXXXXXXX",
  apiSecret: "REPLACE_WITH_ENV_VAR",
  apiHost: stub.url, // <- points at the local stub instead of real Google infra
});
await runCheckoutFlow(provider);
```

## Expected output

### `run-with-noop.ts`

```
done -- noopProvider accepts every call and does nothing (see README for why there is no other output).
```

`noopProvider` declares every capability `true` and implements every
method as a genuine no-op, so `identify()`/`track()`/`flush()`/`destroy()`
all resolve successfully with zero other output -- this is expected, not a
bug: it demonstrates the app runs to completion against *any*
`AnalyticsProvider`, including one that intentionally does nothing.

### `run-with-ga4-local-stub.ts`

```json
[
  {
    "method": "POST",
    "pathname": "/mp/collect",
    "searchParams": {
      "measurement_id": "G-XXXXXXXXXX",
      "api_secret": "REPLACE_WITH_ENV_VAR"
    },
    "body": {
      "client_id": "<uuid -- will differ per run>",
      "timestamp_micros": 1785665703500000,
      "events": [
        { "name": "begin_checkout", "params": { "cartValue": 119.98, "itemCount": 2 } }
      ],
      "user_id": "user_42",
      "user_properties": {
        "email": { "value": "ada@example.com" },
        "plan": { "value": "pro" }
      }
    }
  },
  {
    "method": "POST",
    "pathname": "/mp/collect",
    "searchParams": {
      "measurement_id": "G-XXXXXXXXXX",
      "api_secret": "REPLACE_WITH_ENV_VAR"
    },
    "body": {
      "client_id": "<uuid -- will differ per run, same value as above>",
      "timestamp_micros": 1785665703515000,
      "events": [
        {
          "name": "purchase",
          "params": {
            "transaction_id": "order_9001",
            "value": 119.98,
            "items": [
              { "id": "sku_1", "name": "Wireless Mouse" },
              { "id": "sku_2", "name": "Mechanical Keyboard" }
            ]
          }
        }
      ],
      "user_id": "user_42",
      "user_properties": {
        "email": { "value": "ada@example.com" },
        "plan": { "value": "pro" }
      }
    }
  }
]
```

(`client_id`/`timestamp_micros` values will differ per run; the shape and
every other value are exactly reproducible.) Note `"Checkout Started"` /
`"Purchase Completed"` became GA4's recommended `"begin_checkout"` /
`"purchase"` event names, and `orderId`/`total` became `transaction_id`/
`value` -- both per `@typetrack/provider-ga4`'s default event/property maps.
`cartValue`/`itemCount` have no default GA4 mapping, so they pass through
unchanged.

### `run-with-ga4.ts`

**Do not run this as written outside of a sandboxed/offline environment.**
Its default `apiHost` is `https://www.google-analytics.com` (GA4's real
Measurement Protocol endpoint) -- it will attempt two real HTTPS requests
carrying the placeholder `measurementId`/`apiSecret` shown above. Google
will very likely reject them (invalid credentials), but the network
request itself still leaves your machine. Use
`run-with-ga4-local-stub.ts` (above) for a safe dry run instead, or edit
`apiHost` yourself before running.

## Explanation

**The only thing that changes between `run-with-noop.ts` and
`run-with-ga4.ts` is the provider construction.** `app.ts` never imports
from `@typetrack/provider-ga4` and never references any GA4-specific
concept (Measurement Protocol, `measurement_id`, recommended event names,
`user_properties`, ...) -- it only calls the provider-agnostic `Analytics`
interface (`identify`/`track`/`flush`/`destroy`). This is the Golden Rule
from `plan/VISION.md`: switching providers means editing one file (the one
that constructs `createAnalytics()`), not application code, event names,
or payload shapes.

Concretely:

- Same two `track()` calls (`"Checkout Started"`, `"Purchase Completed"`)
  with the same properties, in the same order, in every entry point.
- Same `identify()` call, same traits, in every entry point.
- Only the provider's *own* internal handling of those identical calls
  differs: `noopProvider` discards everything; `createGA4Provider`
  translates event/property names per its own default maps and issues an
  HTTP request per call.
- `buildCheckoutStartedPayload`/`buildPurchaseCompletedPayload` are pure
  functions with zero dependency on which provider is in play -- they run
  identically regardless.

## Production notes

- **Real credentials belong in environment variables, never hardcoded.**
  `run-with-ga4.ts`'s `measurementId`/`apiSecret` are placeholders for
  exactly this reason -- a real app would read
  `process.env.GA4_MEASUREMENT_ID` / `process.env.GA4_API_SECRET` (or your
  framework's equivalent secret-loading mechanism) instead of a literal
  string in source.
- **Swapping providers in a real app means editing exactly the file that
  constructs `createAnalytics()`** -- typically a single `analytics.ts` (or
  similar) module your app imports everywhere else, analogous to
  `run-with-noop.ts`/`run-with-ga4.ts` here, not a `run-with-*.ts` per
  provider.
- **`run-with-ga4-local-stub.ts`'s stub is a testing/demo convenience, not
  a mock of GA4's full behavior** -- it only records the shape of requests
  it receives and returns `204` unconditionally; it does not validate
  Measurement Protocol semantics the way real Google infrastructure would.
