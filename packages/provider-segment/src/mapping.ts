// Shared event-name/property-name mapping logic for both of this package's
// factories -- the SDK-based `createSegmentProvider` (`./index.ts`) and the
// zero-dependency, fetch()-based `createSegmentFetchProvider` (`./fetch.ts`).
// Extracted verbatim (issue 002) from the SDK-based adapter's original
// implementation -- `createSegmentProvider`'s behavior is unchanged by this
// extraction (regression-tested).

export interface SegmentPropertyMapConfig {
  global?: Record<string, string>;
  events?: Record<string, Record<string, string>>;
}

// Canonical event name -> Segment's recommended B2B SaaS / Ecommerce v2 spec
// event name. Per https://segment.com/docs/connections/spec/b2b-saas/ and
// https://segment.com/docs/connections/spec/ecommerce/v2/. Not an exhaustive
// catalogue -- a reasonably useful, cited starting set (see issue's
// Out-of-scope).
export const DEFAULT_EVENT_MAP: Record<string, string> = {
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
export const DEFAULT_PROPERTY_MAP = {
  events: {
    "Purchase Completed": { orderId: "order_id", total: "revenue" },
    "Product Viewed": { productId: "product_id", name: "name" },
  },
} satisfies SegmentPropertyMapConfig;

// Merges a config's `eventMap` override over `DEFAULT_EVENT_MAP` (override
// wins on key collision; new keys are added).
export function mergeEventMap(override?: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_EVENT_MAP, ...override };
}

// Merges a config's `propertyMap` override over `DEFAULT_PROPERTY_MAP`,
// per-event (override wins on key collision within an event's map; new event
// keys are added) plus a `global` fallback map (override wins wholesale,
// since `DEFAULT_PROPERTY_MAP` has no `global` entries of its own).
export function mergePropertyMap(
  override?: SegmentPropertyMapConfig,
): { global?: Record<string, string>; events: Record<string, Record<string, string>> } {
  const mergedEvents: Record<string, Record<string, string>> = {};
  for (const key of new Set([...Object.keys(DEFAULT_PROPERTY_MAP.events), ...Object.keys(override?.events ?? {})])) {
    mergedEvents[key] = {
      ...DEFAULT_PROPERTY_MAP.events[key as keyof typeof DEFAULT_PROPERTY_MAP.events],
      ...override?.events?.[key],
    };
  }
  return {
    global: { ...override?.global },
    events: mergedEvents,
  };
}

// Builds a stateful `translateEventName` closure backing the warn-once-per-
// unmapped-canonical-event-name policy -- each caller (i.e. each provider
// instance) gets its own independent `warnedEventNames` set.
export function createEventNameTranslator(eventMap: Record<string, string>): (name: string) => string {
  const warnedEventNames = new Set<string>();

  return function translateEventName(name: string): string {
    const mapped = eventMap[name];
    if (mapped !== undefined) return mapped;
    if (!warnedEventNames.has(name)) {
      warnedEventNames.add(name);
      console.warn(
        `@typetrack/provider-segment: no eventMap entry for canonical event name "${name}" -- passing it through unchanged.`,
      );
    }
    return name;
  };
}

// Builds a `translateProperties` closure over a merged property map.
// `eventName` is provided for `track()` (property translation is looked up
// per-event, then falls back to the global map); omitted for `page()`/
// `screen()`, which use the global map only -- neither goes through
// `eventMap`, so there is no "current event name" to key a per-event
// property lookup on (same reasoning as the GA4 adapter's `page()`).
export function createPropertyTranslator(
  propertyMap: { global?: Record<string, string>; events: Record<string, Record<string, string>> },
): (properties: Record<string, unknown>, eventName?: string) => Record<string, unknown> {
  return function translateProperties(
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
  };
}
