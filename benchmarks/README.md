# benchmarks

Internal measurement tooling verifying this repo's own artifacts (cold
start, memory, throughput, bundle size, tree-shaking) -- not a published
package, and not a user-facing "how to use typetrack" example (see
`plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 2).
`node_modules` here also holds the real, pinned vendor SDK packages
(`posthog-js`, `@segment/analytics-next`, `@rudderstack/analytics-js`) this
phase's cross-library comparison measures against, as `devDependencies`
local to this workspace only (Design decision 3).

## Running

```sh
bun install       # once, at the repo root
cd benchmarks
bun run bench          # mitata suite -- cold start/memory/throughput for typetrack itself
bun run bench:browser  # Playwright/Chromium suite -- cross-library comparison
```

Numbers produced here are regenerated on demand by a human (a release, a
significant `src/` change, a vendor SDK version bump), never as a CI gate
(Design decision 6) -- see the BRIEF for why comparative timing numbers on
a shared CI runner aren't trustworthy trend data.

The human-readable output of what this workspace measures lives in
`docs/performance.md` and `docs/comparison.md`.
