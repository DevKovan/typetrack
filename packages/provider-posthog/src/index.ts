// `runtimes` research (Phase 13 issue 003), verified against the installed
// `posthog-node@5.47.3`: its `package.json` `exports["."]` map declares
// distinct conditional entrypoints -- `edge`/`edge-light`/`workerd` all
// resolve to `dist/entrypoints/index.edge.js(.mjs)`, `node` (and the bare
// `import`/`require` fallback) resolves to `dist/entrypoints/index.node.js
// (.mjs)`. Both entrypoints' `PostHog` class extends the same
// `PostHogBackendClient` (`dist/client.js`), whose HTTP transport is
// `this.options.fetch ?? fetch` -- i.e. plain `fetch()`, never `node:http`/
// `node:https` -- confirmed by reading `dist/client.js` directly (its
// `fetch()`/`_fetchWithRetry` methods) and by grepping the whole `dist/`
// tree for `node:https`/`node:http`/`node:net`, which found none. So a
// bundler/runtime that sets the `workerd` (Cloudflare Workers) or
// `edge-light` (Vercel Edge Functions) export condition resolves to the
// edge-flavored build automatically, with no code change needed on this
// adapter's side -- genuine, SDK-declared edge support, not a guess.
// `browser` is excluded, though: the package declares no `browser` export
// condition, so a browser bundler falls through to the same bare `import`/
// `require` fallback Node gets (`index.node.js(.mjs)`), and that entrypoint
// unconditionally `require()`s `../extensions/error-tracking/modifiers/
// context-lines.node.js` at module-load time, which itself does
// `require("node:fs")` -- unconditionally, even though this adapter never
// calls the error-tracking API that would use it. `node`/`bun`/`deno` are
// all included: they all resolve to that same `node:fs`-requiring
// `index.node.js` build, but all three runtimes genuinely implement
// `node:fs` (Bun and Deno both ship substantial Node-API compatibility
// layers), so it loads and runs there without issue.
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

// The exact subset of `posthog-node`'s `PostHog` instance surface this
// adapter calls. Test-only seam: unit tests construct a plain object
// implementing this interface directly (no vendor SDK involved at all) and
// pass it to `createPostHogProviderWithClient` below, instead of using
// `mock.module("posthog-node", ...)` -- module mocking that specifier
// turned out to leak across test files sharing Bun's single test process
// (confirmed empirically: even an `afterAll` that re-mocks the real class
// back doesn't take effect before a later file's own top-level `import`
// already resolved against the polluted module, since Bun evaluates every
// test file's top-level code before any hook runs). Dependency injection
// sidesteps the whole module-cache-sharing problem instead of fighting it.
export interface PostHogClientLike {
  capture(props: { distinctId: string; event: string; properties?: Record<string, unknown>; timestamp?: Date }): void;
  identify(props: { distinctId: string; properties?: Record<string, unknown> }): void;
  groupIdentify(props: { groupType: string; groupKey: string; properties?: Record<string, unknown> }): void;
  alias(props: { distinctId: string; alias: string }): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

// Builds the `AnalyticsProvider` translation layer against an
// already-constructed client -- shared by `createPostHogProvider` (real
// `posthog-node` client) and every unit test (a hand-written fake
// implementing `PostHogClientLike`, no module mocking involved).
export function createPostHogProviderWithClient(
  client: PostHogClientLike,
  config: Pick<PostHogProviderConfig, "eventMap" | "propertyMap"> = {},
): AnalyticsProvider {
  const { eventMap: eventMapOverride, propertyMap: propertyMapOverride } = config;

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
    // adapter, so both are `false`. `runtimes`: see the research paragraph
    // at the top of this file -- `posthog-node`'s own `package.json`
    // `exports` map declares real edge-runtime entrypoints (`workerd`/
    // `edge-light`), so `"edge"` is included; `"browser"` is excluded
    // because the package's fallback build (what a browser bundler
    // resolves to, absent a dedicated `browser` condition) unconditionally
    // requires `node:fs` at module-load time.
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
      runtimes: ["node", "edge", "bun", "deno"],
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

// Synchronously constructs exactly one real `posthog-node` client and
// delegates to `createPostHogProviderWithClient` above. This is the
// factory app code actually calls.
//
// Identity design (see issue for full rationale): this adapter keeps no
// identity state of its own. `distinctId` is derived per-call from
// `event.userId ?? event.anonymousId` for every `track()`/`page()`/
// `screen()` call, since core (issue 002) already stamps identity onto
// every `CanonicalEvent`. There is no adapter-owned `distinctId` variable
// and nothing is "promoted" on `identify()` -- that entire mechanism from
// the pre-Phase-6 adapter is gone.
export function createPostHogProvider(config: PostHogProviderConfig): AnalyticsProvider {
  const { apiKey, eventMap, propertyMap, ...options } = config;
  const client = new PostHog(apiKey, options);
  return createPostHogProviderWithClient(client, { eventMap, propertyMap });
}
