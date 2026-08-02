import { noopProvider } from "typetrack";
import { runCheckoutFlow } from "./app";

// The only line that differs from `run-with-ga4.ts` is this one: which
// `AnalyticsProvider` gets constructed. `app.ts` itself is identical in
// both entry points.
await runCheckoutFlow(noopProvider);

console.log("done -- noopProvider accepts every call and does nothing (see README for why there is no other output).");
