# e2e

Real-browser (Chromium, via Playwright) end-to-end specs for this repo's own
two genuinely browser-only, otherwise-untested surfaces: the bundled IIFE
global build (`dist/index.global.js`) and the `pagehide` +
`navigator.sendBeacon` offline-queue unload flush
(`ReliabilityOptions.flushOnUnload`). See
`plan/phase-16-testing-infrastructure/006-playwright-e2e.md` and that
phase's `BRIEF.md` for the full rationale.

## Prerequisites

Run `bun run build` at the repo root first -- these specs load the actual
built `../dist/index.global.js` artifact, not a copy or an inline bundle.
Also run `bunx playwright install --with-deps chromium` once, to install the
Chromium browser binary Playwright drives.

## Running

```sh
bun install                                    # once, at the repo root
bun run build                                  # repo root -- produces dist/
bunx playwright install --with-deps chromium   # once
cd e2e
bun run test                                   # or: bunx playwright test
```

`playwright.config.ts`'s `webServer` option starts/stops `server.ts` (a
tiny fixture static-file server, doubling as a request log the specs poll)
automatically -- no separate process to manage by hand.
