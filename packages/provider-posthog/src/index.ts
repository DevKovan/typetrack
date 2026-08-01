import { PostHog } from "posthog-node";
import type { AnalyticsProvider } from "typetrack";

// Config accepted by `createPostHogProvider`. A deliberate subset of
// `posthog-node`'s `PostHogOptions` -- only the options this adapter has been
// verified against (see the field-name verification against the installed
// `posthog-node` version's type declarations in the issue). `apiKey` is
// passed as the SDK's first constructor argument; everything else is
// forwarded as-is into `PostHogOptions`.
export interface PostHogProviderConfig {
  apiKey: string;
  host?: string;
  flushAt?: number;
  flushInterval?: number;
  requestTimeout?: number;
  disableGeoip?: boolean;
}

// Synchronously constructs exactly one `posthog-node` client and returns an
// `AnalyticsProvider` bridging core's identify-then-track model onto
// PostHog's per-call `distinctId` requirement.
//
// Identity-state design (see issue for full rationale): the adapter starts
// with a randomly generated anonymous distinct ID. Every `track()`/`page()`
// call uses whatever the *current* distinct ID is. `identify(userId)` both
// forwards to the vendor's `identify()` and promotes `userId` to be the
// current distinct ID for all subsequent calls on this provider instance.
export function createPostHogProvider(config: PostHogProviderConfig): AnalyticsProvider {
  const { apiKey, ...options } = config;
  const client = new PostHog(apiKey, options);

  let distinctId: string = crypto.randomUUID();

  return {
    name: "posthog",

    track(event, payload, meta) {
      client.capture({
        distinctId,
        event,
        properties: payload,
        timestamp: new Date(meta.timestamp),
      });
    },

    identify(userId, traits) {
      client.identify({ distinctId: userId, properties: traits });
      distinctId = userId;
    },

    page(name, props) {
      client.capture({
        distinctId,
        event: "$pageview",
        properties: { ...props, ...(name === undefined ? {} : { name }) },
      });
    },

    async flush() {
      // Only `flush()` -- never `shutdown()`. Core's `Analytics.flush()` is
      // not a terminal "close" operation, and this adapter must stay usable
      // after it's called.
      await client.flush();
    },
  };
}
