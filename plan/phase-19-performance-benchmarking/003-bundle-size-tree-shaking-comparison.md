# Issue 003: bundle-size and tree-shaking comparison

## Context

Read `plan/phase-19-performance-benchmarking/BRIEF.md` in full first,
especially the Research grounding table (real vendor sizes, already
fetched) and Design decisions 5 and 7. Read root `.size-limit.json` and
`docs/performance.md`'s existing "Bundle size" table — this issue's own
results table should be presented in the same style, extended with the
three vendor columns. Read `tsup.config.ts` (typetrack's own build config)
to understand how to produce a minimal-import build for the tree-shaking
check.

Depends on issue 001 (`benchmarks/` workspace + vendor devDependencies
installed).

## Scope

### Part A — bundle size

1. Create `benchmarks/vendor-sizes.json`, a committed, sourced snapshot with
   this exact shape (fill in real values — the ones already fetched and
   recorded in BRIEF.md's Research grounding table; re-verify them against
   the currently-installed `node_modules/<pkg>/package.json` `version`
   field at implementation time and re-fetch from bundlephobia's API
   (`https://bundlephobia.com/api/size?package=<name>`) if the pinned
   version in issue 001 differs from what BRIEF.md cites):
   ```json
   {
     "source": "https://bundlephobia.com/api/size?package=<name>",
     "fetchedAt": "2026-08-10",
     "packages": {
       "posthog-js": { "version": "1.414.0", "minifiedBytes": 236469, "gzipBytes": 77616, "hasSideEffects": true, "hasJSModule": true },
       "@segment/analytics-next": { "version": "1.84.1", "minifiedBytes": 103185, "gzipBytes": 28246, "hasSideEffects": null, "hasJSModule": true },
       "@rudderstack/analytics-js": { "version": "3.31.6", "minifiedBytes": 106918, "gzipBytes": 31123, "hasSideEffects": true, "hasJSModule": true }
     }
   }
   ```
   (Confirm `@segment/analytics-next`'s `hasSideEffects` field for real by
   re-checking the API response — BRIEF's fetch didn't surface it
   explicitly; don't leave a guessed value in a "sourced" file.)
2. Write `benchmarks/bundle-size-report.ts`, a small script that: reads this
   snapshot; reads typetrack's own real, already-built `dist/index.js` and
   `dist/index.global.js` gzip sizes (compute with Bun's own `Bun.gzipSync`
   or shell out to `gzip -c | wc -c` — pick whichever is simpler and more
   reliable in a script context; do not depend on `.size-limit.json`'s
   *budget* numbers, use the real built output, same as this phase's BRIEF
   did by hand); and renders a Markdown comparison table to
   `benchmarks/results/bundle-size.md`. Run it and commit the real output —
   same "no fabricated numbers" rule as issue 002.
3. The generated table must include: package name, version, raw minified
   bytes, gzip bytes, and gzip-bytes-as-a-multiple-of-typetrack's-own
   (e.g. "5.1x" for a vendor 5.1 times typetrack's core ESM gzip size) so
   the comparison is immediately legible, not just raw numbers a reader has
   to do division on themselves.

### Part B — tree-shaking

1. Create `benchmarks/tree-shake-fixture/entry.ts` — a minimal file that
   imports **only** `createAnalytics` and `noopProvider` from `typetrack`
   and calls `createAnalytics({ provider: noopProvider })` (nothing else —
   no middleware, no plugins, no schemas). This is the "smallest possible
   real usage" case.
2. Build it with the same toolchain already in this repo's devDependencies
   (`tsup` or a direct `esbuild` invocation — `tsup` already depends on
   `esbuild` internally, confirm whether a bare `esbuild` binary is
   reachable via `bunx esbuild` without adding a new root/`benchmarks`
   dependency, and prefer that over adding `esbuild` as a fresh explicit
   dependency if it's already resolvable). Minify + treat `typetrack` as
   resolved from the real installed `node_modules/typetrack` (built by
   issue 001's `bun install`/this repo's own `bun run build`), not a
   relative source import — the point is measuring what an app's own
   bundler would actually produce when importing the *published* shape.
3. Record the built, minified, gzipped size of this minimal fixture vs. the
   full `dist/index.js` gzip size in `benchmarks/results/tree-shaking.md` —
   a real percentage reduction, e.g. "importing only `createAnalytics` +
   `noopProvider` produces a bundle N% smaller than importing everything,
   because every middleware/plugin/provider-adapter helper is a separate
   named export the bundler can statically eliminate when unused." Cite the
   specific export-list evidence from `src/index.ts` for *why* this works
   (mirrors `docs/performance.md`'s existing "What's free when unused"
   section's claim — this issue turns that claim into a measured number).
4. For the three vendors, tree-shaking is verified by **static inspection
   only** (no build attempt needed or expected — see BRIEF Design decision
   7): report each vendor's `hasSideEffects` value from
   `vendor-sizes.json` and state the direct implication (`hasSideEffects:
   true` means a bundler cannot safely eliminate unused exports without a
   package explicitly opting in via a `sideEffects` allowlist in its own
   `package.json`, which is a real, verifiable constraint on those
   packages' tree-shakability regardless of import shape). Do not attempt
   to build a minimal-import fixture against any vendor SDK — these are
   whole-SDK browser libraries with side-effectful global initialization by
   design, and forcing a "minimal import" through them would test something
   fictional, not how any real app actually uses them.

Add `benchmarks/bundle-size-report.test.ts` — a unit test asserting the
report-generation script's own correctness (parses `vendor-sizes.json`
correctly, computes the multiple/percentage math correctly on a known
fixture input) — not asserting a specific real byte count (that would
break on the next dependency bump, and isn't this test's job; per BRIEF
Design decision 6 real numbers live in the committed results file, not in
an assertion).

## Explicitly not in this issue

- Cold start / memory / throughput, own or comparative (issues 002, 004,
  005).
- Re-fetching vendor numbers live at build/test/CI time (Design decision
  5 — this is a one-time, dated snapshot).

## Acceptance criteria

- `benchmarks/vendor-sizes.json` exists with real, source-cited numbers
  (verify `@segment/analytics-next`'s `hasSideEffects` field specifically —
  do not leave the placeholder `null` from this issue's own example above).
- `benchmarks/results/bundle-size.md` and `benchmarks/results/
  tree-shaking.md` both exist with real, actually-computed numbers (not
  hand-written).
- `bundle-size-report.test.ts` passes.
- `bun run lint`/`typecheck`/`knip` stay green with the new files included.
