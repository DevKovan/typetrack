import { createGA4Provider } from "@typetrack/provider-ga4";
import { runCheckoutFlow } from "./app";
import { startGA4Stub } from "./ga4-stub-server";

// Safe dry run: starts a local stub in-process standing in for GA4's
// Measurement Protocol endpoint, points `apiHost` at it instead of the real
// `https://www.google-analytics.com`, and prints every request the stub
// received. No real network call ever leaves this process.
const stub = startGA4Stub();

const provider = createGA4Provider({
  measurementId: "G-XXXXXXXXXX",
  apiSecret: "REPLACE_WITH_ENV_VAR",
  apiHost: stub.url,
});

await runCheckoutFlow(provider);

console.log(JSON.stringify(stub.requests, null, 2));

stub.stop();
