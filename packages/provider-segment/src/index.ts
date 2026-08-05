// `runtimes` research (Phase 13 issue 003), verified against the installed
// `@segment/analytics-node@3.1.0`: its default HTTP transport
// (`dist/cjs/lib/http-client.js`'s `FetchHTTPClient`, wired up via
// `dist/cjs/lib/fetch.js`) is `globalThis.fetch(...)` -- plain `fetch()`,
// never `node:http`/`node:https` -- and grepping the whole `dist/` tree for
// `node:http`/`node:https`/`node:net` found no matches. Unlike
// `posthog-node`, though, this package's own `package.json` declares no
// `exports` field at all (only `main`/`module`/`types`), so there is no
// SDK-declared edge/browser entrypoint to resolve to -- every runtime gets
// the identical Node-oriented `dist/cjs`/`dist/esm` build. That build is
// still safe under Node/Bun/Deno: its one runtime-sensitive dependency,
// `@lukeed/csprng` (used transitively for UUID generation), declares a real
// `browser` export condition of its own, but *this* package's plain
// (conditionless) `require`/`import` of it resolves to `@lukeed/csprng`'s
// Node build (`node/index.js`, `require("node:crypto")`) -- fine in
// Node/Bun/Deno (all three implement `node:crypto`), but not verified safe
// in a plain browser bundle or Cloudflare Workers/Vercel Edge (neither
// guarantees `node:crypto`, and nothing in this dependency chain redirects
// them to `@lukeed/csprng`'s browser build without a bundler-level
// `browser`-condition remap this codebase doesn't control). So `runtimes`
// below is `["node", "bun", "deno"]` -- `"browser"`/`"edge"` are omitted,
// not because the SDK is known to fail there, but because nothing in this
// dependency chain has been verified to work there.
import { Analytics } from "@segment/analytics-node";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";
import { createEventNameTranslator, createPropertyTranslator, mergeEventMap, mergePropertyMap } from "./mapping";

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
  // Overrides merged over `DEFAULT_EVENT_MAP`/`DEFAULT_PROPERTY_MAP`
  // (`./mapping.ts`) (override wins on key collision; see
  // `mergeEventMap`/`mergePropertyMap` for the exact algorithm).
  eventMap?: Record<string, string>;
  propertyMap?: {
    global?: Record<string, string>;
    events?: Record<string, Record<string, string>>;
  };
}

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

  const eventMap = mergeEventMap(eventMapOverride);
  const propertyMap = mergePropertyMap(propertyMapOverride);
  const translateEventName = createEventNameTranslator(eventMap);
  const translateProperties = createPropertyTranslator(propertyMap);

  return {
    name: "segment",

    // `runtimes`: see the research paragraph at the top of this file --
    // `@segment/analytics-node`'s HTTP transport is `fetch`-based, but the
    // package declares no edge/browser `exports` entrypoint and its
    // `@lukeed/csprng` dependency resolves to a `node:crypto`-based build
    // under this package's plain (conditionless) import, so only
    // Node-API-compatible runtimes are declared.
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
      runtimes: ["node", "bun", "deno"],
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

// Re-exported alongside `createSegmentProvider`/`SegmentProviderConfig` above
// -- the zero-vendor-dependency, `fetch()`-based sibling factory (issue 002).
export { createSegmentFetchProvider } from "./fetch";
export type { SegmentFetchProviderConfig } from "./fetch";
