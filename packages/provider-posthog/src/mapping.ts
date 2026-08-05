// Shared canonical-event/property translation logic for this package's two
// factories (`createPostHogProvider` in `index.ts`, `createPostHogFetchProvider`
// in `fetch.ts`). Extracted so both adapters produce byte-for-byte-equivalent
// translated event names/properties for the same config (issue 001,
// `plan/phase-13-runtime-agnostic/001-posthog-fetch-provider.md`) -- neither
// factory defines this logic inline anymore.

// Default canonical-event-name -> PostHog event-name table. PostHog imposes
// no vendor-mandated ecommerce-event-naming scheme: `capture()` accepts any
// string as an event name, and PostHog's own ecommerce-event-spec docs
// (https://posthog.com/docs/data/event-spec/ecommerce-events) describe an
// *optional, recommended* naming convention, not an enforced one. So this
// default table is identity/passthrough for the six shared canonical event
// names -- overriding via `config.eventMap` still works, but no spurious
// "unmapped name" warning fires for the names typetrack ships by default.
export const DEFAULT_EVENT_MAP: Record<string, string> = {
  "User Signed Up": "User Signed Up",
  "User Logged In": "User Logged In",
  "Checkout Started": "Checkout Started",
  "Purchase Completed": "Purchase Completed",
  "Product Viewed": "Product Viewed",
  "Search Performed": "Search Performed",
};

// Shape of the property-name mapping table: an optional global fallback plus
// optional per-event overrides, merged with the same override-wins rules as
// the GA4 adapter (issue 003). PostHog has no vendor-mandated property
// naming either, so the default table below is empty (pure passthrough).
export interface PostHogPropertyMap {
  global?: Record<string, string>;
  events?: Record<string, Record<string, string>>;
}

const DEFAULT_PROPERTY_MAP: PostHogPropertyMap = {};

// Merges a `config.propertyMap` override over `DEFAULT_PROPERTY_MAP`:
// `global` merges shallowly (override wins per key); `events` merges
// per-event-key, so for every event key present in either the default or the
// override, the merged per-event map is `{ ...defaultEvents[key],
// ...overrideEvents[key] }` (override wins within that event's map; a key
// present only in the override is included as-is).
export function mergePropertyMap(
  override?: PostHogPropertyMap,
): { global: Record<string, string>; events: Record<string, Record<string, string>> } {
  const global = { ...DEFAULT_PROPERTY_MAP.global, ...override?.global };
  const eventKeys = new Set([
    ...Object.keys(DEFAULT_PROPERTY_MAP.events ?? {}),
    ...Object.keys(override?.events ?? {}),
  ]);
  const events: Record<string, Record<string, string>> = {};
  for (const key of eventKeys) {
    events[key] = { ...DEFAULT_PROPERTY_MAP.events?.[key], ...override?.events?.[key] };
  }
  return { global, events };
}

// Property translation is applied to `event.properties` only, for `track()`
// -- not for `page()`/`screen()`, whose properties are folded directly from
// `event.properties` with no event-name-keyed lookup, since both always map
// to their own fixed PostHog event name ("$pageview"/"$screen"), never
// through `eventMap`. For each key, look up the per-event override first,
// then the global map, else pass the key through unchanged.
export function translateProperties(
  eventName: string,
  properties: Record<string, unknown>,
  propertyMap: { global: Record<string, string>; events: Record<string, Record<string, string>> },
): Record<string, unknown> {
  const perEvent = propertyMap.events[eventName];
  const translated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    translated[perEvent?.[key] ?? propertyMap.global[key] ?? key] = value;
  }
  return translated;
}

// Unmapped-canonical-event-name translation + warn-once helper. `warnedNames`
// is owned by the caller (one `Set<string>` per provider *instance*, not
// shared module-level state) so two independently-constructed providers each
// get their own independent warn-once bookkeeping for the lifetime of that
// instance -- at most one `console.warn` per unique unmapped name per
// instance.
export function translateEventName(name: string, eventMap: Record<string, string>, warnedNames: Set<string>): string {
  const mapped = eventMap[name];
  if (mapped !== undefined) return mapped;
  if (!warnedNames.has(name)) {
    warnedNames.add(name);
    console.warn(
      `[typetrack:posthog] Unmapped canonical event name "${name}"; passing it through to PostHog unchanged.`,
    );
  }
  return name;
}
