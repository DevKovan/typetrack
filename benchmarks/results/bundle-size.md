# Bundle size comparison

Produced by running `cd benchmarks && bun run bundle-size-report.ts`. Vendor numbers sourced from https://bundlephobia.com/api/size?package=<name>, fetched 2026-08-10 (see `benchmarks/vendor-sizes.json`, Design decision 5 -- a dated snapshot, not re-fetched live). typetrack's own numbers are measured directly from this repo's real, already-built `dist/` output (`bun run build`, then gzip'd in-process), not `.size-limit.json`'s budget numbers.

| Package | Version | Minified (raw) | Minified+gzip | gzip vs. typetrack core ESM |
|---|---|---|---|---|
| `typetrack` (ESM -- dist/index.js) | (workspace) | 68,744 B | 15,810 B | 1.0x |
| `typetrack` (IIFE/CDN -- dist/index.global.js) | (workspace) | 30,985 B | 11,008 B | 0.7x |
| `posthog-js` | 1.414.0 | 236,469 B | 77,616 B | 4.9x |
| `@segment/analytics-next` | 1.84.1 | 103,185 B | 28,246 B | 1.8x |
| `@rudderstack/analytics-js` | 3.31.6 | 106,918 B | 31,123 B | 2.0x |

The last column expresses every row's gzip size as a multiple of typetrack's own core ESM (`dist/index.js`) gzip size -- e.g. "5.1x" means that row is 5.1 times larger, gzipped, than typetrack's core build.
