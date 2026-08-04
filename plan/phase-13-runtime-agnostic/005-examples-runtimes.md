# 005 — `examples/runtimes/`

## Context

Depends on issues 001-004 (fetch-based adapters, `runtimes` capability,
SSR-safety confirmed). Per `plan/VISION.md`'s Examples policy — every
feature ships its `examples/` entries in the same phase that built it —
this closes out Phase 13. `examples/runtimes/` is the exact directory
name the ROADMAP's Phase 13 line specifies.

Read `examples/advanced/README.md` (Phase 12) for the established index
structure. This issue's examples differ from every prior phase's in one
important way: three of the four subdirectories are **not** meant to be
run via `bun test`/`bun run` in this repo — they are real
runtime-specific entry points (a Cloudflare Worker's `fetch` handler, a
Vercel Edge Function route, a Deno script) that a reader would copy into
their own Worker/Edge/Deno project and deploy there. Per BRIEF.md decision
5, this repo does not add `wrangler`/`vercel`/Deno tooling as a
dependency — so these three are source-plus-README only. The fourth (Bun)
is genuinely runnable and tested in this repo, since Bun is already this
repo's own toolchain.

## Scope of this issue

`examples/runtimes/README.md` — index explaining the directory's unique
shape up front (which subdirectories are tested-in-repo vs.
source-only-with-deploy-instructions, and why), linking all four
subdirectories with a one-paragraph description each.

### `examples/runtimes/cloudflare-worker/`

A minimal, realistic Cloudflare Worker `fetch` handler
(`src/index.ts`, using Workers' `ExportedHandler` shape) that constructs
`createAnalytics({ provider: createGA4Provider(...) })` (or
`createPostHogFetchProvider`/`createSegmentFetchProvider` from issues
001/002 — pick whichever best demonstrates the point, or show more than
one) inside the handler and calls `track()` for an incoming request,
awaiting `flush()` before returning the response (Workers' request
lifecycle requires explicit `ctx.waitUntil()` for any async work that
outlives the response — demonstrate this correctly, citing Cloudflare's
own docs on `waitUntil` via a code comment). Includes a `wrangler.toml`
(config file only — not an installed/invoked dependency) and a README
with Prerequisites (a Cloudflare account + the `wrangler` CLI, installed
by the reader, not this repo)/How to run (`wrangler dev`, `wrangler
deploy`)/Source/Explanation/Production notes sections. No `package.json`
`file:../../..` dependency install step is tested in this repo's CI —
state this explicitly in the README's own "Testing" note.

### `examples/runtimes/vercel-edge/`

A minimal Vercel Edge Function (Next.js `app/api/track/route.ts` shape,
`export const runtime = "edge"`) demonstrating the same pattern —
construct an `Analytics` instance per-request (Edge Functions are
stateless/short-lived; document why a per-request instance, not a
module-level singleton, is the correct pattern here, contrasting with a
typical long-lived Node server where a singleton would be normal) and
`track()` an event based on the incoming request, `await flush()` before
returning the `Response`. README with Prerequisites (a Next.js app + a
Vercel account)/How to run (`next dev`, `vercel deploy`)/Source/
Explanation/Production notes, same "not tested in this repo's CI" note.

### `examples/runtimes/bun/`

A genuinely runnable Bun script (following the established `examples/*`
shape exactly: `package.json` with `file:../../..` dependency, `index.ts`,
integration test, `expected-output.txt`, README with the standard
Prerequisites/How to run/Source/Expected output/Explanation/Production
notes sections) demonstrating `createAnalytics()` with a fetch-based
provider (issue 001 or 002) running directly under `bun run`/`bun test` —
this is the one subdirectory that IS wired into this repo's own test
suite, explicitly noted as such in its README to contrast with the other
three.

### `examples/runtimes/deno/`

A minimal Deno script (`main.ts`, using Deno's standard `import` syntax —
`import { createAnalytics } from "npm:typetrack"` or equivalent, per
current Deno npm-specifier conventions — verify the exact current syntax
via `WebFetch` against Deno's own docs before writing it, rather than
assuming) demonstrating the same core usage pattern. README with
Prerequisites (Deno installed)/How to run (`deno run main.ts`)/Source/
Explanation/Production notes, same "not tested in this repo's CI, no Deno
toolchain dependency added" note (per BRIEF.md decision 5).

## Acceptance criteria

- `examples/runtimes/README.md` exists, explains the tested-vs-source-only
  split up front, links all four subdirectories.
- All four subdirectories contain correct, realistic, runnable-if-a-reader-
  followed-the-README code — not pseudocode. Realistic event/property
  names only, no `test`/`foo`/`bar` placeholders.
- `examples/runtimes/bun/` follows the full established example shape
  (package.json, integration test, expected-output.txt) and its test
  passes under this repo's own `bun test`.
- Each of the other three subdirectories' READMEs explicitly and clearly
  states it is not exercised by this repo's own CI/test suite, and why
  (no corresponding toolchain dependency added, per BRIEF.md decision 5) —
  a reader should never be confused into thinking `bun test` at the repo
  root somehow validates the Cloudflare Worker/Vercel Edge/Deno examples.
- Each Production notes section covers the request-lifecycle correctness
  point relevant to that runtime (Workers' `waitUntil`, Edge Functions'
  per-request-instance pattern, Deno's npm-specifier import, Bun's direct
  Node-compatible `import`).

## Test requirements

- `examples/runtimes/bun/` requires a genuine integration test, per the
  established example convention.
- The other three subdirectories require no automated test in this repo
  (explicitly, per Scope/Acceptance criteria above) — do not attempt to
  fake one (e.g. do not add a `wrangler`/`vercel`/`deno` devDependency
  just to make a test pass in CI; that directly contradicts BRIEF.md
  decision 5).

## Out of scope

- Any change to `src/` or `packages/*` — this issue is examples-only.
- Adding `wrangler`/`vercel`/Deno as a repo dependency, or CI wiring for
  any of the three non-Bun examples.
- Live deployment to real Cloudflare/Vercel infrastructure.
