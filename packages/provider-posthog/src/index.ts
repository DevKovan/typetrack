import { PostHog } from "posthog-node";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";
import {
  DEFAULT_EVENT_MAP,
  mergePropertyMap,
  translateEventName as translateEventNameShared,
  translateProperties,
  type PostHogPropertyMap,
} from "./mapping";

export type { PostHogPropertyMap };
export { createPostHogFetchProvider, type PostHogFetchProviderConfig } from "./fetch";

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
  // provider instance. `warnedEventNames` is this instance's own `Set`, per
  // `mapping.ts`'s `translateEventName` contract.
  const warnedEventNames = new Set<string>();
  function translateEventName(name: string): string {
    return translateEventNameShared(name, eventMap, warnedEventNames);
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
