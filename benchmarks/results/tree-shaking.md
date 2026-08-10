# Tree-shaking comparison

Produced by running `cd benchmarks && bun run tree-shake-report.ts`. Part 1 is a real, measured build; Part 2 is static inspection only (see `plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 7 -- no vendor SDK minimal-import fixture is built).

## Part 1 -- typetrack's own minimal-import fixture (measured)

`benchmarks/tree-shake-fixture/entry.ts` imports **only** `createAnalytics` and `noopProvider` from the real, installed `typetrack` package (this workspace's own `node_modules/typetrack`, a `file:..` dependency resolving to the actually-built `dist/` output) -- no middleware, no plugins, no schemas. Bundled + minified with `esbuild` (`--bundle --minify --format=esm --platform=browser`), then gzip'd, and compared against the full `dist/index.js` gzip size (same measurement as `benchmarks/results/bundle-size.md`).

| Build | Raw (minified) | Gzip |
|---|---|---|
| Minimal fixture (`createAnalytics` + `noopProvider` only) | 18,443 B | 6,656 B |
| Full `dist/index.js` (everything exported) | 68,744 B | 15,810 B |

Importing only `createAnalytics` + `noopProvider` produces a gzipped bundle **57.9% smaller** than importing everything typetrack exports, because every middleware, plugin, and provider-adapter helper is a separate named export in `src/index.ts` (e.g. `export { redactMiddleware } from "./middleware/redact"`, `export { autoPage } from "./plugins/autoPage"`, and so on through that file's full export list) that a tree-shaking bundler can statically eliminate when unused -- this is a measured number, not a claim (mirrors `docs/performance.md`'s existing "What's free when unused" section).

## Part 2 -- vendor SDKs (static inspection only, no build attempted)

Source: https://bundlephobia.com/api/size?package=<name>, fetched 2026-08-10 (see `benchmarks/vendor-sizes.json`). Per BRIEF Design decision 7, no minimal-import fixture is built against any vendor SDK -- these are whole-SDK browser libraries with side-effectful global initialization by design (feature-flag fetches, autocapture wiring, session-recording setup, etc. at import/init time), and forcing a "minimal import" through them would test something fictional, not how any real app actually uses them.

| Package | `hasSideEffects` | Implication |
|---|---|---|
| `posthog-js` | true | A bundler cannot safely eliminate unused exports from this package without it explicitly opting in via a `sideEffects` allowlist in its own `package.json` -- unused imports are not guaranteed to be tree-shaken. |
| `@segment/analytics-next` | false | Declares itself side-effect-free -- a bundler can safely eliminate unused exports. |
| `@rudderstack/analytics-js` | true | A bundler cannot safely eliminate unused exports from this package without it explicitly opting in via a `sideEffects` allowlist in its own `package.json` -- unused imports are not guaranteed to be tree-shaken. |
