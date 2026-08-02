import { Analytics } from "@segment/analytics-node";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";

// Config accepted by `createSegmentProvider`. A deliberate subset of
// `@segment/analytics-node`'s `AnalyticsSettings` -- only the options this
// adapter has been verified against (see the field-name verification
// against the installed `@segment/analytics-node` version's type
// declarations in the issue). `writeKey` is required; everything else is
// forwarded as-is into `AnalyticsSettings`.
export interface SegmentProviderConfig {
  writeKey: string;
  host?: string;
  path?: string;
  maxEventsInBatch?: number;
  flushInterval?: number;
  // Overrides merged over `DEFAULT_EVENT_MAP`/`DEFAULT_PROPERTY_MAP` below
  // (override wins on key collision; see `createSegmentProvider`'s merge
  // logic for the exact algorithm).
  eventMap?: Record<string, string>;
  propertyMap?: {
    global?: Record<string, string>;
    events?: Record<string, Record<string, string>>;
  };
}

// Canonical event name -> Segment's recommended B2B SaaS / Ecommerce v2 spec
// event name. Per https://segment.com/docs/connections/spec/b2b-saas/ and
// https://segment.com/docs/connections/spec/ecommerce/v2/. Not an exhaustive
// catalogue -- a reasonably useful, cited starting set (see issue's
// Out-of-scope).
const DEFAULT_EVENT_MAP: Record<string, string> = {
  "User Signed Up": "Signed Up",
  "User Logged In": "Signed In",
  "Checkout Started": "Checkout Started",
  "Purchase Completed": "Order Completed",
  "Product Viewed": "Product Viewed",
  "Search Performed": "Products Searched",
};

// Canonical property name -> Segment's Ecommerce v2 spec property name, keyed
// per canonical event name (`events`) plus an optional `global` fallback
// applied regardless of event name. Per Segment's "Order Completed"
// (`order_id`, `revenue`, `currency`) and "Product Viewed" (`product_id`,
// `name`, `price`) fields, same spec URL as above.
const DEFAULT_PROPERTY_MAP = {
  events: {
    "Purchase Completed": { orderId: "order_id", total: "revenue" },
    "Product Viewed": { productId: "product_id", name: "name" },
  },
} satisfies { global?: Record<string, string>; events?: Record<string, Record<string, string>> };

type Identity = { userId: string; anonymousId: string } | { anonymousId: string };

// Builds the identity object Segment's client methods expect, directly from
// a `CanonicalEvent` -- no adapter-owned identity state is read or written
// here, unlike the pre-rewrite adapter's `anonymousId`/`userId`/`identity()`
// trio (deleted; see issue for rationale). Two calls with different
// `event.anonymousId` values always produce different identity objects.
function identityFrom(event: CanonicalEvent): Identity {
  return event.userId === undefined
    ? { anonymousId: event.anonymousId }
    : { userId: event.userId, anonymousId: event.anonymousId };
}

// Synchronously constructs exactly one `@segment/analytics-node` client and
// returns an `AnalyticsProvider` bridging core's canonical-event model onto
// Segment's userId/anonymousId identity-stitching pattern, event-name/
// property-name mapping tables (with config overrides), and the vendor
// client's real lifecycle surface.
//
// Identity design (see issue for full rationale): every `track()`/`page()`/
// `screen()` call derives its identity object directly from the
// `CanonicalEvent` it's given (`event.anonymousId`/`event.userId`, both
// already stamped by core) -- the adapter keeps no identity state of its own.
//
// Lifecycle design (the breaking change from phase 2 -- see issue): verified
// directly against the installed `@segment/analytics-node@3.1.0`'s type
// declarations (`dist/types/app/analytics-node.d.ts`,
// `dist/types/app/types/params.d.ts`): the client exposes a genuine
// non-terminal `flush({ timeout, close })` (default `close: false`,
// confirmed by reading the compiled implementation too --
// `dist/esm/app/analytics-node.js` -- `flush()` only sets `_isClosed` when
// `close` is passed `true`, which this adapter never does), separate from
// the terminal `closeAndFlush()` (which calls `flush({ ..., close: true })`
// under the hood). So `flush()` now maps to the confirmed non-terminal
// method -- the adapter remains fully usable after it resolves -- and
// `destroy()` is the new terminal operation.
export function createSegmentProvider(config: SegmentProviderConfig): AnalyticsProvider {
  const { eventMap: eventMapOverride, propertyMap: propertyMapOverride, ...clientSettings } = config;
  const client = new Analytics(clientSettings);

  const eventMap: Record<string, string> = { ...DEFAULT_EVENT_MAP, ...eventMapOverride };

  const mergedEventsPropertyMap: Record<string, Record<string, string>> = {};
  for (const key of new Set([
    ...Object.keys(DEFAULT_PROPERTY_MAP.events),
    ...Object.keys(propertyMapOverride?.events ?? {}),
  ])) {
    mergedEventsPropertyMap[key] = {
      ...DEFAULT_PROPERTY_MAP.events[key as keyof typeof DEFAULT_PROPERTY_MAP.events],
      ...propertyMapOverride?.events?.[key],
    };
  }
  const propertyMap: { global?: Record<string, string>; events: Record<string, Record<string, string>> } = {
    global: { ...propertyMapOverride?.global },
    events: mergedEventsPropertyMap,
  };

  // Backs the warn-once-per-unmapped-canonical-event-name policy below.
  const warnedEventNames = new Set<string>();

  function translateEventName(name: string): string {
    const mapped = eventMap[name];
    if (mapped !== undefined) return mapped;
    if (!warnedEventNames.has(name)) {
      warnedEventNames.add(name);
      console.warn(
        `@typetrack/provider-segment: no eventMap entry for canonical event name "${name}" -- passing it through unchanged.`,
      );
    }
    return name;
  }

  // `eventName` is provided for `track()` (property translation is looked up
  // per-event, then falls back to the global map); omitted for `page()`/
  // `screen()`, which use the global map only -- neither goes through
  // `eventMap`, so there is no "current event name" to key a per-event
  // property lookup on (same reasoning as the GA4 adapter's `page()`).
  function translateProperties(
    properties: Record<string, unknown>,
    eventName?: string,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      const perEvent = eventName === undefined ? undefined : propertyMap.events[eventName]?.[key];
      const mappedKey = perEvent ?? propertyMap.global?.[key] ?? key;
      result[mappedKey] = value;
    }
    return result;
  }

  return {
    name: "segment",

    capabilities: {
      identify: true,
      group: true,
      alias: true,
      page: true,
      screen: true,
      batching: true,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },

    track(event) {
      client.track({
        ...identityFrom(event),
        event: translateEventName(event.name),
        properties: translateProperties(event.properties, event.name),
        timestamp: new Date(event.timestamp),
      });
    },

    identify(userId, traits, anonymousId) {
      // Forward only -- no internal state kept. Every subsequent
      // `track()`/`page()`/`screen()` call already carries the correct
      // `event.userId`/`event.anonymousId` directly from core.
      client.identify({ userId, anonymousId, traits });
    },

    group(groupId, traits, identity) {
      client.group({
        ...(identity.userId === undefined
          ? { anonymousId: identity.anonymousId }
          : { userId: identity.userId, anonymousId: identity.anonymousId }),
        groupId,
        traits,
      });
    },

    alias(newUserId, previousUserId, anonymousId) {
      client.alias({ userId: newUserId, previousId: previousUserId ?? anonymousId });
    },

    page(event) {
      client.page({
        ...identityFrom(event),
        name: event.name === "" ? undefined : event.name,
        properties: translateProperties(event.properties),
      });
    },

    screen(event) {
      client.screen({
        ...identityFrom(event),
        name: event.name === "" ? undefined : event.name,
        properties: translateProperties(event.properties),
      });
    },

    async flush() {
      // The confirmed non-terminal method (see the verification note
      // above) -- `close` is left `undefined`/defaulted to `false`, so the
      // client is never marked closed and stays fully usable afterward.
      await client.flush();
    },

    reset() {
      // No-op: no adapter-owned identity state remains after this rewrite
      // (see `identityFrom` above) -- there is nothing left to reset.
    },

    async destroy() {
      // Drain (non-terminal), then permanently close. `closeAndFlush()`
      // alone would already drain-then-close, but the preceding `flush()`
      // is kept for symmetry with the documented "drain then tear down"
      // contract, per the issue -- verified harmless: `flush()` sets its
      // internal `_isFlushing` guard back to `false` once it resolves, so
      // there is no overlapping-flush warning from the `closeAndFlush()`
      // call that immediately follows.
      await client.flush();
      await client.closeAndFlush();
    },
  };
}
