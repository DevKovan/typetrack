import { PostHog } from "posthog-node";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";

// Default canonical-event-name -> PostHog event-name table. PostHog imposes
// no vendor-mandated ecommerce-event-naming scheme: `capture()` accepts any
// string as an event name, and PostHog's own ecommerce-event-spec docs
// (https://posthog.com/docs/data/event-spec/ecommerce-events) describe an
// *optional, recommended* naming convention, not an enforced one. So this
// default table is identity/passthrough for the six shared canonical event
// names -- overriding via `config.eventMap` still works, but no spurious
// "unmapped name" warning fires for the names typetrack ships by default.
const DEFAULT_EVENT_MAP: Record<string, string> = {
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

// Config accepted by `createPostHogProvider`. A deliberate subset of
// `posthog-node`'s `PostHogOptions` -- only the options this adapter has been
// verified against (see the field-name verification against the installed
// `posthog-node` version's type declarations in the issue). `apiKey` is
// passed as the SDK's first constructor argument; `eventMap`/`propertyMap`
// are consumed by this adapter only (never forwarded to the SDK);
// everything else is forwarded as-is into `PostHogOptions`.
export interface PostHogProviderConfig {
  apiKey: string;
  host?: string;
  flushAt?: number;
  flushInterval?: number;
  requestTimeout?: number;
  disableGeoip?: boolean;
  eventMap?: Record<string, string>;
  propertyMap?: PostHogPropertyMap;
}

// Merges a `config.propertyMap` override over `DEFAULT_PROPERTY_MAP`:
// `global` merges shallowly (override wins per key); `events` merges
// per-event-key, so for every event key present in either the default or the
// override, the merged per-event map is `{ ...defaultEvents[key],
// ...overrideEvents[key] }` (override wins within that event's map; a key
// present only in the override is included as-is).
function mergePropertyMap(
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
function translateProperties(
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

// Synchronously constructs exactly one `posthog-node` client and returns an
// `AnalyticsProvider` translating core's canonical event model onto
// PostHog's `capture`/`identify`/`groupIdentify`/`alias` API.
//
// Identity design (see issue for full rationale): this adapter keeps no
// identity state of its own. `distinctId` is derived per-call from
// `event.userId ?? event.anonymousId` for every `track()`/`page()`/
// `screen()` call, since core (issue 002) already stamps identity onto
// every `CanonicalEvent`. There is no adapter-owned `distinctId` variable
// and nothing is "promoted" on `identify()` -- that entire mechanism from
// the pre-Phase-6 adapter is gone.
export function createPostHogProvider(config: PostHogProviderConfig): AnalyticsProvider {
  const { apiKey, eventMap: eventMapOverride, propertyMap: propertyMapOverride, ...options } = config;
  const client = new PostHog(apiKey, options);

  const eventMap: Record<string, string> = { ...DEFAULT_EVENT_MAP, ...eventMapOverride };
  const propertyMap = mergePropertyMap(propertyMapOverride);

  // Unmapped-canonical-event-name warn-once bookkeeping: at most one
  // `console.warn` per unique unmapped name for the lifetime of this
  // provider instance.
  const warnedEventNames = new Set<string>();
  function translateEventName(name: string): string {
    const mapped = eventMap[name];
    if (mapped !== undefined) return mapped;
    if (!warnedEventNames.has(name)) {
      warnedEventNames.add(name);
      console.warn(
        `[typetrack:posthog] Unmapped canonical event name "${name}"; passing it through to PostHog unchanged.`,
      );
    }
    return name;
  }

  return {
    name: "posthog",

    // Researched, truthfully declared against posthog-node 5.47.3:
    // `groupIdentify()`/`alias()` are real methods (group/alias `true`);
    // `flushAt`/`flushInterval` batch client-side (`batching: true`); no
    // persistent offline queue survives a restart (`offline: false`);
    // `getFeatureFlag`/`getAllFlags` are real methods (`featureFlags: true`,
    // declarative only this phase -- no core verb calls it yet); session
    // replay and heatmaps are `posthog-js` (browser) capture-time features
    // with no server-SDK equivalent -- this is a server-side (Node)
    // adapter, so both are `false`.
    capabilities: {
      identify: true,
      group: true,
      alias: true,
      page: true,
      screen: true,
      batching: true,
      offline: false,
      featureFlags: true,
      sessionReplay: false,
      heatmaps: false,
    },

    track(event: CanonicalEvent) {
      client.capture({
        distinctId: event.userId ?? event.anonymousId,
        event: translateEventName(event.name),
        properties: translateProperties(event.name, event.properties, propertyMap),
        timestamp: new Date(event.timestamp),
      });
    },

    identify(userId, traits) {
      // Forward only -- no internal state kept. There is nothing left to
      // "promote" to a current distinct ID: track()/page()/screen() already
      // derive `distinctId` per-call straight from the CanonicalEvent's own
      // `userId`/`anonymousId`.
      client.identify({ distinctId: userId, properties: traits });
    },

    group(groupId, traits) {
      // Design decision: PostHog's `groupIdentify()` requires both a
      // `groupType` and a `groupKey`, but core's `group(groupId, traits)`
      // verb supplies only one identifier. This adapter uses a fixed
      // constant `groupType: "group"` for every call, with `groupKey:
      // groupId` -- a narrow, real design choice bridging the shape
      // mismatch between core's single-identifier verb and PostHog's
      // two-identifier group model. Verified against posthog-node 5.47.3's
      // `GroupIdentifyMessage` type: the group-traits field is named
      // `properties`, not `groupProperties`.
      client.groupIdentify({ groupType: "group", groupKey: groupId, properties: traits });
    },

    alias(newUserId, previousUserId, anonymousId) {
      // Verified against posthog-node 5.47.3's type declarations: `alias()`
      // takes `{ distinctId, alias, disableGeoip? }` -- no other field
      // names exist for this call.
      client.alias({ distinctId: newUserId, alias: previousUserId ?? anonymousId });
    },

    page(event: CanonicalEvent) {
      client.capture({
        distinctId: event.userId ?? event.anonymousId,
        event: "$pageview",
        properties: { ...event.properties, ...(event.name === "" ? {} : { name: event.name }) },
      });
    },

    screen(event: CanonicalEvent) {
      // Folds an optional name into `properties` under the key `name`, for
      // consistency with this adapter's existing `page()` convention,
      // rather than inventing a PostHog-specific `$screen_name` convention
      // that isn't already established in this codebase.
      client.capture({
        distinctId: event.userId ?? event.anonymousId,
        event: "$screen",
        properties: { ...event.properties, ...(event.name === "" ? {} : { name: event.name }) },
      });
    },

    async flush() {
      // Only `flush()` -- never `shutdown()`. Core's `Analytics.flush()` is
      // not a terminal "close" operation, and this adapter must stay usable
      // after it's called.
      await client.flush();
    },

    reset() {
      // No-op: there is no adapter-owned identity state left to clear after
      // this rewrite (track()/page()/screen() derive `distinctId` per-call
      // straight from the CanonicalEvent). The interface's `reset?()` hook
      // remains legal to call here; it is simply a legitimate no-op for
      // this adapter's design.
    },

    async destroy() {
      // Flush first so no queued events are lost, then permanently close
      // the client. Verified against posthog-node 5.47.3's type
      // declarations: the public terminal method is `shutdown()` (distinct
      // from the internal `_shutdown()` also present on the base class).
      await client.flush();
      await client.shutdown();
    },
  };
}
