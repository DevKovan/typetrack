# Migration guide

Moving from a direct vendor SDK to typetrack, or from this repo's own
pre-Phase-6 event shape.

## From direct PostHog usage (`posthog-node`/`posthog-js`)

```ts
// Before — direct posthog-node
import { PostHog } from "posthog-node";
const posthog = new PostHog(apiKey);
posthog.capture({ distinctId: userId, event: "User Signed Up", properties: { plan: "pro" } });
posthog.identify({ distinctId: userId, properties: { plan: "pro" } });
```

```ts
// After — typetrack
import { createAnalytics } from "typetrack";
import { createPostHogProvider } from "@typetrack/provider-posthog";

const analytics = createAnalytics({ provider: createPostHogProvider({ apiKey }) });
analytics.identify(userId, { plan: "pro" });
analytics.track("User Signed Up", { plan: "pro" });
```

`identify`/`group`/`alias`/`page` map onto PostHog's `identify()`/
`groupIdentify()`/`alias()`/`$pageview` capture internally — see
`packages/provider-posthog/src/index.ts`'s `createPostHogProviderWithClient`
for the exact translation. Canonical event/property names are translated
via a default table you can override (`eventMap`/`propertyMap`, see
`packages/provider-posthog/src/mapping.ts`). Two adapter variants exist —
an SDK-based one (`createPostHogProvider`) and a zero-dependency
`fetch()`-based one (`createPostHogFetchProvider`) — see
[`docs/providers/posthog.md`](./providers/posthog.md) for the full
reference and which to pick.

## From direct Segment usage (`@segment/analytics-node`)

```ts
// Before — direct @segment/analytics-node
import { Analytics } from "@segment/analytics-node";
const segment = new Analytics({ writeKey });
segment.track({ userId, event: "User Signed Up", properties: { plan: "pro" } });
```

```ts
// After — typetrack
import { createAnalytics } from "typetrack";
import { createSegmentProvider } from "@typetrack/provider-segment";

const analytics = createAnalytics({ provider: createSegmentProvider({ writeKey }) });
analytics.track("User Signed Up", { plan: "pro" });
```

Identity fields (`userId`/`anonymousId`) are derived per-call directly from
the `CanonicalEvent` core builds — see `identityFrom()` in `packages/
provider-segment/src/index.ts`. One subtlety worth knowing up front:
`analytics.flush()` maps to Segment's **non-terminal** `flush()` (the
adapter stays usable afterward); `analytics.destroy()` is the terminal
operation (`closeAndFlush()`) — cite that same file's own lifecycle-design
comment, which documents this exact distinction (and that the pre-rewrite
adapter used to have it backwards). Two adapter variants exist here too —
SDK-based (`createSegmentProvider`) and a zero-dependency, HTTP-Basic-Auth
`fetch()`-based one (`createSegmentFetchProvider`) — see
[`docs/providers/segment.md`](./providers/segment.md).

## From direct GA4 Measurement Protocol usage

```ts
// Before — raw fetch to the Measurement Protocol
await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${id}&api_secret=${secret}`, {
  method: "POST",
  body: JSON.stringify({ client_id: anonId, events: [{ name: "sign_up" }] }),
});
```

```ts
// After — typetrack
import { createAnalytics } from "typetrack";
import { createGA4Provider } from "@typetrack/provider-ga4";

const analytics = createAnalytics({ provider: createGA4Provider({ measurementId, apiSecret }) });
analytics.track("User Signed Up", {});
```

GA4 has no vendor SDK at all — this adapter is a single, pure-`fetch()`
implementation (`packages/provider-ga4/src/index.ts`), so there's no
SDK-vs-fetch choice to make here, unlike PostHog/Segment. The default
canonical→GA4 event-name table covers common events out of the box
(`"User Signed Up"` → `sign_up`, `"User Logged In"` → `login`, `"Checkout
Started"` → `begin_checkout`, `"Purchase Completed"` → `purchase`,
`"Product Viewed"` → `view_item`, `"Search Performed"` → `search`),
overridable via `eventMap`. See [`docs/providers/ga4.md`](./providers/ga4.md).

## From this repo's own pre-Phase-6 `EventMeta` shape

typetrack has never been published to npm, so there is no real external
consumer of its pre-Phase-6 shape to migrate — this section is a short
historical record, not a runbook.

Before Phase 6, `track()` took positional `(event, payload, meta)`
arguments and providers received a bare `EventMeta` (`{ timestamp }`)
alongside the raw payload — every provider adapter had to generate and
track its own identity/session state independently, with no shared,
canonical shape between them. Phase 6 replaced this with the
`CanonicalEvent` described in [`docs/architecture.md`](./architecture.md):
`name`, `properties`, `timestamp`, `anonymousId`, `userId`, `sessionId`,
`context`, `metadata`, generated once by core and handed identically to
every provider. Identity/session state moved into core at the same time —
adapters stopped generating their own. See `plan/phase-6-canonical/
BRIEF.md` and `plan/CHANGELOG.md`'s Phase 6 entry for the full rationale
and scope of that rewrite.
