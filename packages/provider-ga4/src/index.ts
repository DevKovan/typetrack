import type { AnalyticsProvider, CanonicalEvent } from "typetrack";

// Config accepted by `createGA4Provider`. GA4's Measurement Protocol is a
// plain HTTP API -- no vendor SDK is involved (see issue for full
// rationale). `apiHost` defaults to the real Measurement Protocol host but
// is overridable so tests never hit real Google infrastructure.
export interface GA4ProviderConfig {
  measurementId: string;
  apiSecret: string;
  apiHost?: string;
  // Canonical event name -> GA4 recommended event name. Merged over
  // `DEFAULT_EVENT_MAP` (override wins on key collision; new keys are added).
  eventMap?: Record<string, string>;
  // Canonical property name -> GA4 param name, optionally scoped per event.
  // Merged over `DEFAULT_PROPERTY_MAP` (see `createGA4Provider` for the
  // exact per-event merge rule).
  propertyMap?: { global?: Record<string, string>; events?: Record<string, Record<string, string>> };
}

interface MeasurementProtocolBody {
  client_id: string;
  user_id?: string;
  timestamp_micros: number;
  events: Array<{ name: string; params?: Record<string, unknown> }>;
  user_properties?: Record<string, { value: unknown }>;
}

// Default canonical -> GA4 recommended event name mapping, per Google's
// recommended-events reference
// (https://developers.google.com/analytics/devguides/collection/ga4/reference/events)
// and support page (https://support.google.com/analytics/answer/9267735). A
// reasonably useful, cited starting set -- not an exhaustive catalogue.
const DEFAULT_EVENT_MAP: Record<string, string> = {
  "User Signed Up": "sign_up",
  "User Logged In": "login",
  "Checkout Started": "begin_checkout",
  "Purchase Completed": "purchase",
  "Product Viewed": "view_item",
  "Search Performed": "search",
};

// Default per-event property-name mapping, per GA4's `purchase` params
// (`transaction_id`, `currency`, `value`) and `view_item` params (`item_id`/
// `item_name`, `price`, `currency`, `value`), both documented at the same
// Google reference URL above.
const DEFAULT_PROPERTY_MAP = {
  events: {
    "Purchase Completed": { orderId: "transaction_id", total: "value" },
    "Product Viewed": { productId: "item_id", name: "item_name" },
  },
} satisfies { global?: Record<string, string>; events?: Record<string, Record<string, string>> };

// Synchronously builds an `AnalyticsProvider` that POSTs directly to the GA4
// Measurement Protocol's web-stream endpoint via the runtime's native
// `fetch` -- no vendor SDK, no batching, no client-side queue.
//
// Identity-state design (see issue for full rationale): `client_id`/
// `user_id` are sourced directly from `event.anonymousId`/`event.userId` on
// every `track()`/`page()` call -- core (issue 002) already stamps these on
// every `CanonicalEvent`, so this adapter no longer generates or caches an
// identity of its own. `identify(userId, traits, anonymousId)` makes zero
// network calls by itself -- GA4's Measurement Protocol has no standalone
// "set user" endpoint -- it only updates internal state
// (`currentUserProperties`, `traits` mapped into GA4's `user_properties`
// shape) that is attached to the body of subsequent `track()`/`page()`
// requests. The `userId` argument itself is not stored -- every subsequent
// `track()`/`page()` call already carries the correct `event.userId`
// directly from core.
export function createGA4Provider(config: GA4ProviderConfig): AnalyticsProvider {
  const { measurementId, apiSecret, apiHost = "https://www.google-analytics.com" } = config;

  const eventMap: Record<string, string> = { ...DEFAULT_EVENT_MAP, ...config.eventMap };

  const defaultProperties: { global?: Record<string, string>; events: Record<string, Record<string, string>> } =
    DEFAULT_PROPERTY_MAP;
  const defaultEvents = defaultProperties.events;
  const overrideEvents = config.propertyMap?.events ?? {};
  const mergedEvents: Record<string, Record<string, string>> = {};
  for (const key of new Set([...Object.keys(defaultEvents), ...Object.keys(overrideEvents)])) {
    mergedEvents[key] = { ...defaultEvents[key], ...overrideEvents[key] };
  }
  const propertyMap: { global?: Record<string, string>; events: Record<string, Record<string, string>> } = {
    global: { ...defaultProperties.global, ...config.propertyMap?.global },
    events: mergedEvents,
  };

  const warnedEventNames = new Set<string>();

  let currentUserProperties: Record<string, { value: unknown }> | undefined;

  function translateEventName(name: string): string {
    const translated = eventMap[name];
    if (translated !== undefined) return translated;
    if (!warnedEventNames.has(name)) {
      warnedEventNames.add(name);
      console.warn(`[provider-ga4] no eventMap entry for canonical event name "${name}"; passing through unchanged`);
    }
    return name;
  }

  // Translates `event.properties` for `track()` only -- per-event lookup
  // first, then global, else pass the key through unchanged. `page()` never
  // goes through this function since it always maps to the fixed
  // `page_view` GA4 event and has no "current event name" to key off of.
  function translateProperties(eventName: string, properties: Record<string, unknown>): Record<string, unknown> {
    const perEvent = propertyMap.events[eventName];
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      const translatedKey = perEvent?.[key] ?? propertyMap.global?.[key] ?? key;
      result[translatedKey] = value;
    }
    return result;
  }

  function translateGlobalProperties(properties: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      const translatedKey = propertyMap.global?.[key] ?? key;
      result[translatedKey] = value;
    }
    return result;
  }

  async function send(
    events: MeasurementProtocolBody["events"],
    clientId: string,
    userId: string | undefined,
    timestamp: number,
  ) {
    const body: MeasurementProtocolBody = {
      client_id: clientId,
      timestamp_micros: timestamp * 1000,
      events,
      ...(userId === undefined ? {} : { user_id: userId }),
      ...(currentUserProperties === undefined ? {} : { user_properties: currentUserProperties }),
    };

    const url = new URL("/mp/collect", apiHost);
    url.searchParams.set("measurement_id", measurementId);
    url.searchParams.set("api_secret", apiSecret);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`GA4 Measurement Protocol request failed with status ${response.status}`);
    }
  }

  return {
    name: "ga4",

    // GA4 Measurement Protocol has no group/alias/screen concept (web-stream
    // only, app-stream/`firebase_app_id` out of scope); each `track()`/
    // `page()` call issues its own immediate request (no batching); no
    // offline queue, feature flags, session replay, or heatmaps exist in
    // this HTTP-only adapter.
    capabilities: {
      identify: true,
      group: false,
      alias: false,
      page: true,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },

    async track(event: CanonicalEvent) {
      const name = translateEventName(event.name);
      const params = translateProperties(event.name, event.properties);
      await send([{ name, params }], event.anonymousId, event.userId, event.timestamp);
    },

    identify(_userId, traits) {
      currentUserProperties =
        traits === undefined
          ? undefined
          : Object.fromEntries(Object.entries(traits).map(([key, value]) => [key, { value }]));
    },

    async page(event: CanonicalEvent) {
      const translatedProperties = translateGlobalProperties(event.properties);
      const pageTitle = event.name === "" ? undefined : event.name;
      await send(
        [{ name: "page_view", params: { page_title: pageTitle, ...translatedProperties } }],
        event.anonymousId,
        event.userId,
        event.timestamp,
      );
    },

    reset() {
      currentUserProperties = undefined;
    },

    async flush() {
      // No-op -- there is no client-side queue to drain, since every
      // `track()`/`page()` call already dispatches its own request.
    },

    // No persistent connection/timer exists to close -- intentionally a
    // no-op that resolves, not a missing implementation.
    async destroy() {},
  };
}
