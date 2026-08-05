// A minimal Deno script demonstrating `typetrack`'s core usage pattern
// under Deno, using Deno's current `npm:` specifier import syntax (verified
// against Deno's own docs, https://docs.deno.com/runtime/fundamentals/node/,
// as of writing) to import straight from npm package names with no local
// `package.json`/`node_modules`/bundler step of any kind.
//
// NOT run by this repo's own `bun test`/CI -- see
// `examples/runtimes/README.md` and this file's own README.md "Testing"
// note for why (per `plan/phase-13-runtime-agnostic/BRIEF.md` decision 5,
// this repo does not add a Deno toolchain dependency anywhere in the
// monorepo). A reader would run this directly with their own local Deno
// install.

import { createAnalytics } from "npm:typetrack";
import { createGA4Provider } from "npm:@typetrack/provider-ga4";

const analytics = createAnalytics({
  provider: createGA4Provider({
    // `Deno.env.get(...)` is Deno's own standard environment-variable API
    // (require `--allow-env` when running this script) -- never a
    // hardcoded real measurement id/secret in source.
    measurementId: Deno.env.get("GA4_MEASUREMENT_ID") ?? "G-XXXXXXXXXX",
    apiSecret: Deno.env.get("GA4_API_SECRET") ?? "REPLACE_WITH_ENV_VAR",
  }),
});

await analytics.identify("user_deno_7", { plan: "pro" });
await analytics.track("Product Viewed", { sku: "TT-BEANIE-GRY", price: 17.5 });
await analytics.flush();
await analytics.destroy();

console.log("done -- tracked one Product Viewed event via createGA4Provider, running directly under Deno.");
