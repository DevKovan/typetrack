# deno

A minimal Deno script (`main.ts`) using Deno's current `npm:` specifier
import syntax to pull in `typetrack` and `@typetrack/provider-ga4` directly
from their npm package names -- no local `package.json`, `node_modules`, or
bundler step -- and demonstrate the same core `createAnalytics()` usage
pattern (`identify()`/`track()`/`flush()`/`destroy()`) every other
`examples/runtimes/*` entry does.

## Testing

**Not exercised by this repo's own CI/`bun test` suite, and no Deno
toolchain dependency is added to this repo.** Per
`plan/phase-13-runtime-agnostic/BRIEF.md` decision 5, this repo's toolchain
stays exactly `Bun`/`tsgo`/`typescript`/`oxlint`/`Knip`/`tsup`
(`CLAUDE.md`) -- no `deno` binary, test runner, or config is installed or
invoked anywhere in this monorepo. Nothing in this file is run,
type-checked, or linted by `bun install`/`bun test`/`bun run
typecheck`/`bun run lint` at the repo root -- a passing `bun test` at the
repo root proves nothing about whether this script actually runs under
Deno.

## Prerequisites

- Deno installed locally (https://deno.com -- not installed by this repo).
- A real GA4 property's Measurement ID and API secret, exported as
  `GA4_MEASUREMENT_ID`/`GA4_API_SECRET` environment variables (the script
  falls back to placeholder strings otherwise, which Google's real
  Measurement Protocol endpoint will simply reject -- see the "Production
  notes" below before running against real infrastructure).

## How to run

```sh
GA4_MEASUREMENT_ID=G-XXXXXXXXXX GA4_API_SECRET=... \
  deno run --allow-env --allow-net main.ts
```

`--allow-env` is required for `Deno.env.get(...)`; `--allow-net` is
required for the `fetch()` call `createGA4Provider` makes internally --
both are Deno's standard, explicit runtime-permission flags (Deno scripts
have no network/environment access by default, unlike Node/Bun).

## Source

```ts
import { createAnalytics } from "npm:typetrack";
import { createGA4Provider } from "npm:@typetrack/provider-ga4";

const analytics = createAnalytics({
  provider: createGA4Provider({
    measurementId: Deno.env.get("GA4_MEASUREMENT_ID") ?? "G-XXXXXXXXXX",
    apiSecret: Deno.env.get("GA4_API_SECRET") ?? "REPLACE_WITH_ENV_VAR",
  }),
});

await analytics.identify("user_deno_7", { plan: "pro" });
await analytics.track("Product Viewed", { sku: "TT-BEANIE-GRY", price: 17.5 });
await analytics.flush();
await analytics.destroy();
```

## Explanation

`import ... from "npm:typetrack"` is Deno's own documented mechanism for
importing an npm package by its bare package name, without a local
`package.json`/`node_modules`/`deno.json` import-map entry -- Deno resolves
and caches the package directly from the npm registry the first time the
script runs. `createGA4Provider` (from `@typetrack/provider-ga4`) is
`fetch()`-only internally (GA4's Measurement Protocol is a plain HTTP API,
no vendor SDK) -- the same adapter used, unmodified, by
`../cloudflare-worker` and Node/Bun -- so nothing about this file's usage
pattern differs from any other runtime in this directory beyond the import
syntax itself.

## Production notes

- **Deno's permission model is opt-in and explicit.** Unlike Node/Bun,
  a Deno script has *no* filesystem/network/environment access unless
  explicitly granted via `--allow-*` flags (or a single `-A`/`--allow-all`
  for local development convenience, not recommended for anything running
  untrusted code) -- `--allow-net` and `--allow-env` above are the minimum
  this script actually needs; don't reach for `--allow-all` in a real
  deployment.
- **`npm:` specifiers fetch from the real npm registry** -- there is no
  local override/stub involved the way `../cloudflare-worker`'s
  `wrangler.toml`/`../vercel-edge`'s Next.js project would let you point at
  a local dev server; Deno resolves `npm:typetrack`/
  `npm:@typetrack/provider-ga4` from whatever versions are actually
  published, same as any other npm consumer.
- **Never hardcode `GA4_MEASUREMENT_ID`/`GA4_API_SECRET`** -- read them from
  `Deno.env.get(...)` (as this script does) or your deployment platform's
  own secret-management mechanism.
