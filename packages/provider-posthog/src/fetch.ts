import type { AnalyticsProvider, CanonicalEvent } from "typetrack";
import {
  DEFAULT_EVENT_MAP,
  mergePropertyMap,
  translateEventName,
  translateProperties,
  type PostHogPropertyMap,
} from "./mapping";

// Config accepted by `createPostHogFetchProvider`. A deliberate subset of
// `PostHogProviderConfig` (see `index.ts`) -- no `flushAt`/`flushInterval`/
// `requestTimeout`/`disableGeoip` client-batching options, since there is no
// vendor client here to configure them on. `host` defaults to
// `https://us.i.posthog.com`, the same host `posthog-node`'s own
// `DEFAULT_NODE_HOST` resolves to when `createPostHogProvider`'s `config.host`
// is left unset (verified against the installed `posthog-node@5.47.3` ->
// `@posthog/core@1.46.1` dependency's `dist/client.mjs`), so both factories
// in this package talk to the same real endpoint by default.
export interface PostHogFetchProviderConfig {
  apiKey: string;
  host?: string;
  eventMap?: Record<string, string>;
  propertyMap?: PostHogPropertyMap;
}

// Request-body shape for a single PostHog HTTP-capture event, shared by both
// the `/capture/` single-event endpoint and each entry of `/batch/`'s `batch`
// array (both endpoints accept the identical per-event shape -- verified
// against `@posthog/core@1.46.1`'s own `sendBatch()`, which enqueues the same
// `{ event, distinct_id, properties, timestamp? }` object it uses for a
// single `capture()` call directly into its `batch` array with no
// transformation).
interface PostHogCaptureEvent {
  event: string;
  distinct_id: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

// Citations (read in full before writing this file, per issue 001):
// - https://posthog.com/docs/api/capture -- PostHog's "Capture and batch API
//   endpoints" reference. Documents the request shape for a single event
//   (`api_key`/`event`/`distinct_id`/`properties`/`timestamp`) and for
//   `/batch/` (`api_key`/`historical_migration`/`batch: [...]`, each batch
//   entry itself shaped like a single event). Also documents `$identify`
//   (properties: `$set`), `$groupidentify` (properties: `$group_type`,
//   `$group_key`, `$group_set`), and `$create_alias` (properties: `alias`,
//   with the *new* id as the event's own `distinct_id`) as the special
//   event names representing identify/group/alias over this HTTP API --
//   there are no separate identify/group/alias HTTP endpoints.
// - https://posthog.com/docs/api/post-only-endpoints -- redirects (HTTP 308)
//   to the same `/docs/api/capture` page above as of this writing, i.e. the
//   two URLs the issue names are currently the same page.
//
// Note on the endpoint path itself: the docs page above shows `/i/v0/e/` as
// the single-event route in its current examples, rather than `/capture/`.
// Empirically verified (`curl -X POST https://us.i.posthog.com/capture/ ...`
// during research for this file) that `/capture/` is still live and returns
// the same `{"status":"Ok"}` response as `/i/v0/e/` -- it is PostHog's
// original, still-functioning ingestion route (predating the versioned
// `/i/v0/e/` alias) and is what this adapter uses, matching this package's
// existing SDK-based adapter's own established `/batch/`-endpoint convention
// (`createPostHogProvider`'s integration test already asserts against
// `/batch/`; `/capture/` is that same family's singular-event counterpart).
const DEFAULT_HOST = "https://us.i.posthog.com";

// Builds an `AnalyticsProvider` that talks to PostHog's HTTP capture API
// directly via the runtime's native `fetch` -- zero vendor dependency, no
// `posthog-node` import anywhere in this file. Produces the same translated
// event name/properties as `createPostHogProvider` (`index.ts`) for
// equivalent config, since both import their event/property-translation
// logic from the same `./mapping` module.
//
// Identity design: identical rationale to `createPostHogProvider` -- no
// adapter-owned identity state. `distinct_id` is derived per-call from
// `event.userId ?? event.anonymousId`; `identify()`/`group()`/`alias()`
// forward only, with zero "promoted current identity" bookkeeping.
//
// Transport contract: mirrors `packages/provider-ga4/src/index.ts`'s `send()`
// exactly -- every method `await`s its `fetch()` call and throws when
// `response.ok` is false, so a rejected/failed request propagates as a
// rejected promise to the caller (core's reliability queue, issue 002 of
// this phase's sibling BRIEF, is the intended retry mechanism for that
// rejection -- no retry/backoff logic lives in this adapter itself).
export function createPostHogFetchProvider(config: PostHogFetchProviderConfig): AnalyticsProvider {
  const { apiKey, host = DEFAULT_HOST, eventMap: eventMapOverride, propertyMap: propertyMapOverride } = config;

  const eventMap: Record<string, string> = { ...DEFAULT_EVENT_MAP, ...eventMapOverride };
  const propertyMap = mergePropertyMap(propertyMapOverride);

  // This instance's own warn-once bookkeeping -- see `mapping.ts`'s
  // `translateEventName` contract.
  const warnedEventNames = new Set<string>();

  async function post(path: "/capture/" | "/batch/", body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${host}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`PostHog HTTP capture request to ${path} failed with status ${response.status}`);
    }
  }

  function capture(event: PostHogCaptureEvent): Promise<void> {
    return post("/capture/", { api_key: apiKey, ...event });
  }

  function distinctId(event: CanonicalEvent): string {
    return event.userId ?? event.anonymousId;
  }

  // Folds an optional name into `properties` under the key `name`, matching
  // `createPostHogProvider`'s own `page()`/`screen()` convention exactly.
  function namedEventProperties(event: CanonicalEvent): Record<string, unknown> {
    return { ...event.properties, ...(event.name === "" ? {} : { name: event.name }) };
  }

  return {
    name: "posthog-fetch",

    // `identify`/`group`/`alias` map onto PostHog's HTTP capture API as
    // `$identify`/`$groupidentify`/`$create_alias` special events (see
    // citation above) -- real, if `/capture/`-mediated, support, hence
    // `true`. `batching: false` -- this adapter never batches on its own
    // without Phase 12's reliability queue driving it (distinct from
    // `batch: true` below, which is exactly that opt-in signal).
    // `featureFlags: false` -- no `getFeatureFlag`/`getAllFlags`-equivalent
    // HTTP endpoint is implemented by this adapter (out of scope for issue
    // 001). `sessionReplay`/`heatmaps: false` -- both are `posthog-js`
    // (browser) capture-time features with no HTTP-capture-API equivalent.
    // `runtimes` (Phase 13 issue 003): verified by re-reading this entire
    // file -- no `posthog-node` import anywhere in it (see the file-level
    // comment above), the only network call is the runtime's native
    // `fetch()` in `post()`, and no Node-specific global (`process`,
    // `Buffer`, `node:*`) is referenced anywhere in this file. So this
    // adapter runs unmodified anywhere `fetch` is available: Node,
    // browsers, edge (Cloudflare Workers/Vercel Edge -- see
    // `ProviderCapabilities.runtimes`'s doc comment for why these share one
    // category), Bun, and Deno -- same reasoning as
    // `packages/provider-ga4`'s `createGA4Provider`.
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
      batch: true,
      runtimes: ["node", "browser", "edge", "bun", "deno"],
    },

    async track(event: CanonicalEvent) {
      await capture({
        distinct_id: distinctId(event),
        event: translateEventName(event.name, eventMap, warnedEventNames),
        properties: translateProperties(event.name, event.properties, propertyMap),
        timestamp: new Date(event.timestamp).toISOString(),
      });
    },

    async identify(userId, traits) {
      // `$identify` updates person properties via the `$set` property key
      // (https://posthog.com/docs/api/capture, "Identify" section) -- no
      // separate identify HTTP endpoint exists. Forward only, no adapter-side
      // identity-state caching (same rationale as `createPostHogProvider`).
      await capture({
        distinct_id: userId,
        event: "$identify",
        properties: { $set: traits },
      });
    },

    async group(groupId, traits) {
      // `$groupidentify`'s `$group_type`/`$group_key`/`$group_set` property
      // keys (https://posthog.com/docs/api/capture, "Group identify"
      // section). `groupType: "group"` is the same fixed constant
      // `createPostHogProvider` uses to bridge core's single-identifier
      // `group(groupId, traits)` verb onto PostHog's two-identifier group
      // model. `distinct_id` on a `$groupidentify` event isn't meaningful to
      // grouping itself but is still required by the event shape -- this
      // uses the exact same fallback `posthog-node`/`@posthog/core`
      // internally defaults to when no explicit `distinctId` is passed to
      // `groupIdentify()` (verified in `@posthog/core@1.46.1`'s
      // `groupIdentifyStateless`: `` distinctId || `$${groupType}_${groupKey}` ``),
      // so `createPostHogProvider.group()` (which also never passes an
      // explicit `distinctId`) and this method send the identical value.
      // `$group_set` also matches that same source's `groupProperties || {}`
      // fallback.
      await capture({
        distinct_id: `$group_${groupId}`,
        event: "$groupidentify",
        properties: { $group_type: "group", $group_key: groupId, $group_set: traits ?? {} },
      });
    },

    async alias(newUserId, previousUserId, anonymousId) {
      // `$create_alias`'s `distinct_id`/`properties.alias` fields
      // (https://posthog.com/docs/api/capture, "Alias" section) -- the new
      // id is the event's own `distinct_id`, the id being merged into it is
      // `properties.alias`. Matches `createPostHogProvider.alias()`'s exact
      // fallback: `previousUserId ?? anonymousId`.
      await capture({
        distinct_id: newUserId,
        event: "$create_alias",
        properties: { alias: previousUserId ?? anonymousId },
      });
    },

    async page(event: CanonicalEvent) {
      await capture({
        distinct_id: distinctId(event),
        event: "$pageview",
        properties: namedEventProperties(event),
      });
    },

    async screen(event: CanonicalEvent) {
      await capture({
        distinct_id: distinctId(event),
        event: "$screen",
        properties: namedEventProperties(event),
      });
    },

    // Phase 12 issue 005's drain-loop-coalesced batch method: translates
    // every queued event (whatever verb -- track/page/screen -- it was
    // originally destined for) the same way `track()`/`page()`/`screen()`
    // each individually would, then POSTs the whole array in a single
    // `/batch/` request. The entire reason to implement this is to avoid N
    // round trips -- see design decisions in issue 001.
    async trackBatch(events: CanonicalEvent[]) {
      const batch: PostHogCaptureEvent[] = events.map((event) => ({
        distinct_id: distinctId(event),
        event: translateEventName(event.name, eventMap, warnedEventNames),
        properties: translateProperties(event.name, event.properties, propertyMap),
        timestamp: new Date(event.timestamp).toISOString(),
      }));
      await post("/batch/", { api_key: apiKey, batch });
    },

    async flush() {
      // No-op: a `fetch()`-based adapter has no client-side queue/buffer of
      // its own -- every method above already sends its request immediately
      // and awaits it -- so there is nothing here to flush.
    },

    reset() {
      // No-op: no adapter-owned identity state exists to clear (same
      // rationale as `createPostHogProvider.reset()`).
    },

    async destroy() {
      // No-op: no persistent connection, timer, or client instance exists to
      // tear down -- every request this adapter makes is a one-shot `fetch()`
      // call with nothing left over afterward.
    },
  };
}
