# 006 -- Playwright e2e: IIFE global bundle + real-browser flush-on-unload

## Context

Independent of every other issue in this phase (does not depend on
001-005). Read `plan/phase-16-testing-infrastructure/BRIEF.md`'s research-
grounding section (why Playwright, why these two targets specifically, why
Chromium-only) and Design decision 4 (`e2e/` directory placement) first.
Also read, in full, `src/index.ts`'s `flushOnUnload`/`pagehide`/
`navigator.sendBeacon` wiring (~lines 210-260, 798-810, 991-1160,
1140-1160, 1557-1565) and `tsup.config.ts`'s third build entry (the IIFE
`dist/index.global.js` build, `globalName: "Typetrack"`) before writing
any spec.

Adds `@playwright/test` as a new devDependency, scoped to the new `e2e/`
package only (not the root `package.json` -- mirrors how `packages/solid`
scoped `tsup-preset-solid` to itself in Phase 14, not the shared root
toolchain list in CLAUDE.md).

## Scope of this issue

1. New root-level `e2e/` directory (sibling to `src/`, `packages/`,
   `examples/`, `plan/` -- **not** under `examples/`, per BRIEF.md Design
   decision 4), with its own `package.json`:
   ```json
   {
     "name": "e2e",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "scripts": { "test": "playwright test" },
     "devDependencies": { "@playwright/test": "<current stable, verify via WebSearch/npm at implementation time>" },
     "dependencies": { "typetrack": "file:../.." }
   }
   ```
   and its own `playwright.config.ts` (hand-written, **not** generated via
   `create-playwright`/`npm init playwright` -- per BRIEF.md's research
   finding that scaffold hardcodes `npm`, a real friction point in this
   Bun-workspace monorepo). Config points `testDir` at `e2e/tests`, uses
   only the `chromium` project (per BRIEF.md Design decision 5), and
   serves fixture HTML pages via Playwright's own built-in static-file
   web server option (`webServer` config pointing at a tiny fixture
   server -- see part 2 below) rather than a separate hand-rolled server
   process the implementor has to manage lifecycle for.
2. `e2e/fixtures/`: minimal static HTML pages the specs load, each
   `<script src="...">`-loading the **actual built**
   `../../dist/index.global.js` (a real file-relative or served path to
   this repo's own root `dist/` output -- **not** a copy/inline of the
   bundle; the whole point is verifying the artifact `tsup` actually
   produces). Requires `bun run build` (root) to have already run before
   `e2e` tests execute -- document this in `e2e/package.json`'s own
   `"test"` script comment or a short `e2e/README.md`.
3. `e2e/tests/global-bundle.spec.ts`: loads a fixture page in a real
   Chromium page via Playwright, asserts `window.Typetrack` (the
   `globalName` from `tsup.config.ts`) is defined and exposes
   `createAnalytics`, constructs an `Analytics` instance in-page (via
   `page.evaluate()`) with a provider whose `track()` posts to a
   same-origin fixture endpoint the test's own tiny fixture server
   handles (Playwright's `page.route()` interception is a valid,
   simpler alternative to a real endpoint -- implementor's call), calls
   `track()` from within the page, and asserts the real browser actually
   dispatched the request with the expected event name/payload.
4. `e2e/tests/flush-on-unload.spec.ts`: the higher-value spec. Loads a
   fixture page that constructs an `Analytics` instance with
   `flushOnUnload` enabled (check `src/index.ts`'s exact option name/
   config shape for this feature -- read the code, don't guess) and a
   provider/queue configuration that leaves at least one event pending in
   the offline queue (reusing `src/reliability/`'s queue, per how
   `flushOnUnload` is documented to work), sets up a way to observe
   whether the browser actually sent a `navigator.sendBeacon` request on
   unload (either `page.route()` interception of the beacon's target URL,
   or a fixture endpoint that records the request), then triggers a real
   navigation away from the page (`page.goto()` to a second, blank page,
   or `page.close()` -- whichever reliably fires a real `pagehide` event
   in Playwright's Chromium; verify empirically which one does, since
   Playwright's exact navigation-vs-close semantics for `pagehide` firing
   are worth confirming directly rather than assumed), and asserts the
   beacon request was actually received/observed. This is the one
   assertion nothing else in this repo's test suite (happy-dom-based unit
   tests included) can make honestly, per BRIEF.md's research-grounding
   section -- take care to get it right rather than writing a spec that
   only superficially exercises the feature.

5. Add `e2e` to root `package.json`'s `"workspaces"` array and root
   `tsconfig.json`'s `"include"` array (same treatment `examples/*`
   subdirectories already get).
6. Add Playwright's own generated artifacts to `.gitignore`:
   `test-results/`, `playwright-report/`, `playwright/.cache/` (standard
   Playwright output directories -- verify exact current defaults against
   Playwright's own docs at implementation time rather than assuming this
   list is complete).

## Testing

This issue's own specs *are* the test. Verify locally: `bun install`,
`bun run build` (root, to produce `dist/index.global.js`), `bunx
playwright install --with-deps chromium`, then `cd e2e && bun run test`
(or `bunx playwright test` from `e2e/`) -- both specs pass. Re-run each
spec a few times locally to confirm no flakiness (navigation-timing-
dependent specs are more flake-prone than unit tests; if `flush-on-
unload.spec.ts` flakes, investigate rather than papering over it with a
longer timeout/retry -- a flaky assertion about whether a beacon actually
fired is exactly the kind of false-positive-prone test that erodes trust
in this suite).

## Out of scope

Firefox/WebKit (BRIEF.md Design decision 5). Any framework-wrapper
(`@typetrack/react`/etc.) browser E2E -- those are already covered by
Phase 14's own testing-library-based tests at the component level; this
issue targets only the two genuinely-uncovered-anywhere surfaces named
above. Visual regression/screenshot testing.
