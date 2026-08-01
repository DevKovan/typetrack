import type { AnalyticsProvider } from "typetrack";

// Config accepted by `createGA4Provider`. GA4's Measurement Protocol is a
// plain HTTP API -- no vendor SDK is involved (see issue for full
// rationale). `apiHost` defaults to the real Measurement Protocol host but
// is overridable so tests never hit real Google infrastructure.
export interface GA4ProviderConfig {
  measurementId: string;
  apiSecret: string;
  apiHost?: string;
}

interface MeasurementProtocolBody {
  client_id: string;
  user_id?: string;
  timestamp_micros: number;
  events: Array<{ name: string; params?: Record<string, unknown> }>;
  user_properties?: Record<string, { value: unknown }>;
}

// Synchronously builds an `AnalyticsProvider` that POSTs directly to the GA4
// Measurement Protocol's web-stream endpoint via the runtime's native
// `fetch` -- no vendor SDK, no batching, no client-side queue.
//
// Identity-state design (see issue for full rationale): `client_id` is
// generated once per instance (there is no browser cookie to source it from
// server-side) and reused for every request. `identify(userId, traits)`
// makes zero network calls by itself -- GA4's Measurement Protocol has no
// standalone "set user" endpoint -- it only updates internal state
// (`currentUserId`, and `traits` mapped into GA4's `user_properties` shape)
// that is attached to the body of subsequent `track()`/`page()` requests.
export function createGA4Provider(config: GA4ProviderConfig): AnalyticsProvider {
  const { measurementId, apiSecret, apiHost = "https://www.google-analytics.com" } = config;

  const clientId: string = crypto.randomUUID();
  let currentUserId: string | undefined;
  let currentUserProperties: Record<string, { value: unknown }> | undefined;

  async function send(events: MeasurementProtocolBody["events"], timestamp?: number) {
    const body: MeasurementProtocolBody = {
      client_id: clientId,
      timestamp_micros: (timestamp ?? Date.now()) * 1000,
      events,
      ...(currentUserId === undefined ? {} : { user_id: currentUserId }),
      ...(currentUserProperties === undefined ? {} : { user_properties: currentUserProperties }),
    };

    const url = new URL("/mp/collect", apiHost);
    url.searchParams.set("measurement_id", measurementId);
    url.searchParams.set("api_secret", apiSecret);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`GA4 Measurement Protocol request failed with status ${response.status}`);
    }
  }

  return {
    name: "ga4",

    async track(event, payload, meta) {
      await send([{ name: event, params: payload }], meta.timestamp);
    },

    identify(userId, traits) {
      currentUserId = userId;
      currentUserProperties =
        traits === undefined
          ? undefined
          : Object.fromEntries(Object.entries(traits).map(([key, value]) => [key, { value }]));
    },

    async page(name, props) {
      await send([{ name: "page_view", params: { page_title: name, ...props } }]);
    },

    async flush() {
      // No-op -- there is no client-side queue to drain, since every
      // `track()`/`page()` call already dispatches its own request.
    },
  };
}
