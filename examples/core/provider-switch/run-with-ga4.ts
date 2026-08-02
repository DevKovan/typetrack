import { createGA4Provider } from "@typetrack/provider-ga4";
import { runCheckoutFlow } from "./app";

// WARNING: running this file as-is issues real HTTP requests to Google's
// live Measurement Protocol endpoint (`https://www.google-analytics.com`),
// because `createGA4Provider` defaults `apiHost` to that real endpoint. The
// `measurementId`/`apiSecret` below are placeholders, never real
// credentials -- see the README's "Production notes" for where real
// credentials belong (environment variables), and
// `run-with-ga4-local-stub.ts` for a safe dry run against a local stub
// instead of real Google infrastructure.
const provider = createGA4Provider({
  measurementId: "G-XXXXXXXXXX",
  apiSecret: "REPLACE_WITH_ENV_VAR",
});

// The only line that differs from `run-with-noop.ts` is the one above:
// which `AnalyticsProvider` gets constructed. `app.ts` itself is identical
// in both entry points -- it never imports from `@typetrack/provider-ga4`
// or references any GA4-specific concept.
await runCheckoutFlow(provider);
