import type { AnalyticsProvider, CanonicalEvent } from "typetrack";
import { createEventNameTranslator, createPropertyTranslator, mergeEventMap, mergePropertyMap } from "./mapping";

// Config accepted by `createSegmentFetchProvider`. A deliberate subset of
// `SegmentProviderConfig` (`./index.ts`) -- no `path`/`maxEventsInBatch`/
// `flushInterval`, since those are `@segment/analytics-node`'s own
// client-side-batching-queue options and this adapter has no client-side
// queue (every call is its own immediate `fetch()`).
export interface SegmentFetchProviderConfig {
  writeKey: string;
  host?: string;
  // Overrides merged over `DEFAULT_EVENT_MAP`/`DEFAULT_PROPERTY_MAP`
  // (`./mapping.ts`) (override wins on key collision; see
  // `mergeEventMap`/`mergePropertyMap` for the exact algorithm).
  eventMap?: Record<string, string>;
  propertyMap?: {
    global?: Record<string, string>;
    events?: Record<string, Record<string, string>>;
  };
}

// Segment HTTP Tracking API reference, read in full for this issue:
// https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/
// Confirmed against that page:
// - Authentication: HTTP Basic Auth -- the write key as the username, an
//   empty password (i.e. base64("<writeKey>:")), sent as
//   `Authorization: Basic <base64>` ("Basic authentication" section; the
//   docs' own worked example -- write key `abc123` -> `abc123:` ->
//   `YWJjMTIzOg==` -- matches `btoa("abc123:")` byte-for-byte).
// - Six distinct endpoints, each its own POST, under the same host:
//   `/v1/track`, `/v1/page`, `/v1/screen`, `/v1/identify`, `/v1/group`,
//   `/v1/alias` (`/v1/batch` also exists but is explicitly out of scope --
//   see the issue).
// - Default host: `https://api.segment.io` ("Oregon (Default)" region).
// - Body field names, confirmed per-endpoint from the docs' own worked
//   examples: `/v1/track` — `userId`/`anonymousId`, `event`, `properties`,
//   `context`, `timestamp`; `/v1/page` and `/v1/screen` — `userId`/
//   `anonymousId`, `name`, `properties`, `timestamp`; `/v1/identify` —
//   `userId`/`anonymousId`, `traits`, `timestamp`; `/v1/group` — `userId`/
//   `anonymousId`, `groupId`, `traits`, `timestamp`; `/v1/alias` —
//   `previousId`, `userId`, `timestamp`. (The docs' examples also show a
//   `writeKey` body field, but that's for the alternative writeKey-in-body
//   auth scheme -- not used here, since Basic Auth is used instead; the docs
//   note that scheme needs no authentication header at all.)
// - Required content type: `Content-Type: application/json` ("Content-type"
//   section).
//
// `btoa`, never Node's `Buffer`, for the Basic Auth encoding: `Buffer` is not
// universally available in Workers/Edge/browser runtimes and would silently
// defeat this adapter's whole zero-vendor-dependency, runtime-agnostic
// purpose while still technically compiling and passing Node-based tests.
// `writeKey` is expected to be ASCII (Segment write keys are alphanumeric),
// so `btoa(writeKey + ":")` is safe without needing a UTF-8-safe encoding
// shim.
function encodeBasicAuth(writeKey: string): string {
  return btoa(`${writeKey}:`);
}

type IdentityFields = { userId: string; anonymousId: string } | { anonymousId: string };

// Builds the `userId`/`anonymousId` fields Segment's HTTP API expects,
// directly from a `CanonicalEvent` -- no adapter-owned identity state is
// read or written here, matching the SDK-based adapter's own `identityFrom`
// (`./index.ts`). Two calls with different `event.anonymousId` values always
// produce different identity fields.
function identityFieldsFrom(event: CanonicalEvent): IdentityFields {
  return event.userId === undefined
    ? { anonymousId: event.anonymousId }
    : { userId: event.userId, anonymousId: event.anonymousId };
}

// Synchronously builds an `AnalyticsProvider` that POSTs directly to
// Segment's HTTP Tracking API via the runtime's native `fetch` -- no vendor
// SDK (`@segment/analytics-node` is never imported), no client-side queue,
// no batching. Every method issues its own immediate request to its
// endpoint's real, distinct Segment path (see the citation above) and
// awaits it, following this codebase's established fetch-error-propagation
// contract (`packages/provider-ga4/src/index.ts`'s `track()`): a non-`ok`
// response, or a rejected `fetch()` call, propagates as a rejected promise.
//
// Event-name/property-name translation is identical to `createSegmentProvider`
// (`./index.ts`) for equivalent config -- both factories share `./mapping.ts`.
//
// Identity design: same as the SDK-based adapter -- every `track()`/`page()`/
// `screen()` call derives its identity fields directly from the
// `CanonicalEvent` it's given; the adapter keeps no identity state of its
// own. `identify()`/`group()`/`alias()` forward their arguments directly,
// storing nothing.
export function createSegmentFetchProvider(config: SegmentFetchProviderConfig): AnalyticsProvider {
  const { writeKey, host = "https://api.segment.io" } = config;

  const eventMap = mergeEventMap(config.eventMap);
  const propertyMap = mergePropertyMap(config.propertyMap);
  const translateEventName = createEventNameTranslator(eventMap);
  const translateProperties = createPropertyTranslator(propertyMap);

  const authorizationHeader = `Basic ${encodeBasicAuth(writeKey)}`;

  async function post(path: string, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(new URL(path, host), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorizationHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Segment HTTP API request to ${path} failed with status ${response.status}`);
    }
  }

  return {
    name: "segment",

    // No client-side queue/batching of any kind -- every call below issues
    // its own immediate `fetch()` -- and `/v1/batch` support is explicitly
    // deferred (see this issue's Design decisions), so `batch` is omitted
    // rather than set `true` (matches `ProviderCapabilities.batch`'s own
    // documented "omitted = false" convention, `src/providers/index.ts`).
    capabilities: {
      identify: true,
      group: true,
      alias: true,
      page: true,
      screen: true,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },

    async track(event) {
      await post("/v1/track", {
        ...identityFieldsFrom(event),
        event: translateEventName(event.name),
        properties: translateProperties(event.properties, event.name),
        timestamp: new Date(event.timestamp).toISOString(),
      });
    },

    async identify(userId, traits, anonymousId) {
      // Forward only -- no internal state kept, matching the SDK-based
      // adapter's own `identify()`.
      await post("/v1/identify", { userId, anonymousId, traits });
    },

    async group(groupId, traits, identity) {
      await post("/v1/group", {
        ...(identity.userId === undefined
          ? { anonymousId: identity.anonymousId }
          : { userId: identity.userId, anonymousId: identity.anonymousId }),
        groupId,
        traits,
      });
    },

    async alias(newUserId, previousUserId, anonymousId) {
      await post("/v1/alias", { userId: newUserId, previousId: previousUserId ?? anonymousId });
    },

    async page(event) {
      await post("/v1/page", {
        ...identityFieldsFrom(event),
        name: event.name === "" ? undefined : event.name,
        properties: translateProperties(event.properties),
      });
    },

    async screen(event) {
      await post("/v1/screen", {
        ...identityFieldsFrom(event),
        name: event.name === "" ? undefined : event.name,
        properties: translateProperties(event.properties),
      });
    },

    async flush() {
      // No-op -- there is no client-side queue to drain, since every call
      // above already dispatches its own request immediately.
    },

    reset() {
      // No-op: no adapter-owned identity state exists (see
      // `identityFieldsFrom` above) -- there is nothing to reset, matching
      // the SDK-based adapter's own `reset()` rationale.
    },

    // No persistent connection/timer/queue exists to close -- intentionally
    // a no-op that resolves, not a missing implementation (same rationale as
    // the GA4 adapter's own `destroy()`).
    async destroy() {},
  };
}
