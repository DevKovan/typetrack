import { Analytics } from "@segment/analytics-node";
import type { AnalyticsProvider } from "typetrack";

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
}

// Synchronously constructs exactly one `@segment/analytics-node` client and
// returns an `AnalyticsProvider` bridging core's identify-then-track model
// onto Segment's userId/anonymousId identity-stitching pattern.
//
// Identity-state design (see issue for full rationale): the adapter starts
// with a randomly generated `anonymousId`. Every `track()`/`page()` call
// before `identify()` passes `{ anonymousId }` alone. `identify(userId)`
// forwards to the vendor's `identify()` with both `userId` and the original
// `anonymousId` (Segment's documented identity-stitching pattern), and
// stores `userId` so subsequent `track()`/`page()` calls pass both
// `{ userId, anonymousId }`.
//
// Flush is terminal for this adapter: only a closing `closeAndFlush()` is
// confirmed documented for the installed SDK version's public API, so
// `flush()` maps to it. Unlike the PostHog adapter, calling `flush()` here
// is a one-shot, end-of-lifecycle operation -- the adapter is not expected
// to be usable for further calls after `flush()` resolves. (The installed
// version, 3.1.0, does also expose a non-terminal `flush()` on the vendor
// client -- see the commit message / handoff notes for why this adapter
// intentionally does not adopt it, per the issue's explicit scope
// boundary.)
export function createSegmentProvider(config: SegmentProviderConfig): AnalyticsProvider {
  const client = new Analytics(config);

  const anonymousId: string = crypto.randomUUID();
  let userId: string | undefined;

  function identity(): { userId: string; anonymousId: string } | { anonymousId: string } {
    return userId === undefined ? { anonymousId } : { userId, anonymousId };
  }

  return {
    name: "segment",

    track(event, payload, meta) {
      client.track({
        ...identity(),
        event,
        properties: payload,
        timestamp: new Date(meta.timestamp),
      });
    },

    identify(newUserId, traits) {
      client.identify({ userId: newUserId, anonymousId, traits });
      userId = newUserId;
    },

    page(name, props) {
      client.page({
        ...identity(),
        name,
        properties: props,
      });
    },

    async flush() {
      // Only `closeAndFlush()` -- the only confirmed flush primitive for
      // this SDK version's public API per the issue's design decision. This
      // adapter is not expected to be usable for further calls after
      // `flush()` resolves.
      await client.closeAndFlush();
    },
  };
}
