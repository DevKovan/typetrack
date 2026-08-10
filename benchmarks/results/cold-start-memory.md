# Cross-library cold-start + memory comparison

Produced by running `cd benchmarks && bun run bench:browser` (Playwright/Chromium, `tests/cold-start-memory.spec.ts`). See `plan/phase-19-performance-benchmarking/BRIEF.md` Design decision 4 for the overall approach.

## Methodology & fairness caveats

- Every fixture (`../fixtures/typetrack.html`, `../fixtures/posthog.html`, `../fixtures/segment.html`, `../fixtures/rudderstack.html`) is measured against this workspace's own local stub server (`../stub-server.ts`, Bun.serve()), never live vendor infrastructure -- no network call in this run leaves `localhost`.
- Each vendor SDK fixture has its heaviest optional init-time features (autocapture, session recording, feature-flag polling / remote config fetch, destination-plugin auto-loading) explicitly disabled -- the exact options and why are documented in an HTML comment block at the top of each vendor fixture file.
- **These numbers do not represent each vendor SDK's default, out-of-the-box configuration.** A default-configured install of any of these three SDKs would cost measurably more than what's reported here -- see BRIEF.md's "Research grounding" section for why measuring the true default isn't reachable without live vendor infrastructure.
- Cold-start ms is `window.__readyAt` (`performance.now()` at the moment each fixture's own real ready callback/promise fires), captured from a fresh browser context (no reuse) for every single navigation, per fixture, and reduced via median across all runs.
- Heap bytes is `performance.memory.usedJSHeapSize` (Chromium launched with `--enable-precise-memory-info`, see `../playwright.config.ts`), sampled once `window.__ready` is observed, same fresh-context-per-run methodology.

## Results

| Library | Runs | Median cold-start | Median heap |
|---|---|---|---|
| typetrack | 5 | 5.50 ms | 2,100,603 B |
| posthog | 5 | 14.70 ms | 3,254,154 B |
| segment | 5 | 10.70 ms | 2,619,244 B |
| rudderstack | 5 | 19.20 ms | 3,273,328 B |
