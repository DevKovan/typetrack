// Local ingestion-endpoint stub for the cross-library comparison harness
// (issues 004-005). Every vendor SDK fixture points its API host/endpoint
// config at this server instead of the vendor's real ingestion API, so
// cold-start/memory/throughput numbers are reproducible with no network
// access and "vendor server response latency" isn't a confound in what's
// meant to be a client-side SDK overhead comparison. See
// plan/phase-19-performance-benchmarking/BRIEF.md Design decision 4.
//
// Also serves each vendor SDK's real, already-installed browser bundle as a
// static file (from this workspace's own node_modules/), so fixture HTML
// pages (issue 004) can <script src="..."> load the real installed package
// without a live CDN fetch. Also serves this workspace's own fixture HTML
// (`benchmarks/fixtures/*.html`) and typetrack's real, root-built
// `dist/index.global.js` (same `/dist/*` -> repo-root-`dist/` mapping
// `e2e/server.ts` already uses), so one process backs every fixture in
// issue 004's harness.
//
// Exports startStubServer()/stopStubServer() rather than a bare top-level
// Bun.serve() call, so both the mitata suite (if it ever needs it) and
// `stub-server.test.ts` can start/stop it deterministically -- but this file
// *also* starts a real server on module execution when run directly (guarded
// by `import.meta.main`, same "only run when executed directly" shape as any
// Bun script's entry point), so `benchmarks/playwright.config.ts`'s
// `webServer.command` can start it the exact same way
// `e2e/playwright.config.ts` starts `e2e/server.ts` -- `"bun run
// stub-server.ts"` as a plain shell command, not an import (see
// `knip.json`'s `benchmarks` entry for why that needs its own explicit
// "entry" declaration).

import { join } from "node:path";

type StubServer = ReturnType<typeof Bun.serve>;

// Resolved by hand against each package's own package.json main/module
// fields and dist/ layout (none of these three vendor packages publish an
// "unpkg" field) -- the real, script-tag-loadable browser bundle for each,
// not a guess:
//  - posthog-js: dist/array.js is the IIFE bundle PostHog's own snippet
//    loads from its CDN (`v.posthog=i` at the end sets `window.posthog`).
//  - @segment/analytics-next: dist/umd/index.js is the real UMD wrapper
//    (`typeof exports=="object"&&typeof module!="undefined"?module.exports=e()
//    :... :t.AnalyticsNext=e()`) that exposes the actual `AnalyticsBrowser`
//    class as `window.AnalyticsNext.AnalyticsBrowser` -- confirmed by
//    grepping the built file for `AnalyticsBrowser`/`e.load=function`.
//    dist/umd/standalone.js (issue 001's original guess, corrected here) is
//    a *different* artifact: it's the classic analytics.js snippet-loader
//    bundle, which expects a pre-seeded `window.analytics` buffer array from
//    Segment's own inline snippet before it runs, and only sets
//    `window.AnalyticsNext = {}` (an empty object, just a load marker) --
//    not usable for this fixture's `AnalyticsBrowser.load(...)` call shape.
//  - @rudderstack/analytics-js: dist/npm/modern/bundled/umd/index.js is the
//    UMD bundle that sets `global.rudderanalytics = { RudderAnalytics: class }`.
//    This is *not* issue 001's original choice (dist/npm/modern/umd/index.js,
//    the smaller, non-"bundled" default export) -- that build was tried
//    first for this issue and, even with `plugins: []` and
//    `loadIntegration: false` set (see `fixtures/rudderstack.html`), it
//    still made four real `fetch()` calls to `cdn.rudderlabs.com` for core
//    queue-delivery plugin chunks (`rsa-plugins-common`,
//    `rsa-plugins-RetryQueue`, `rsa-plugins-remote-XhrQueue`,
//    `rsa-plugins.js`) -- confirmed by hand via a `page.on("request")`
//    listener in `tests/cold-start-memory.spec.ts` while iterating on this
//    fixture. Per this package's own README ("Available exports"): "Default
//    export will fetch the plugins during runtime as timed federated
//    modules in separate requests[;] Bundled export will contain the
//    plugins code as part of the bundle in build time" -- i.e. those four
//    requests are *core* delivery-queue plugins the "default" export always
//    federates at runtime regardless of the `plugins` load option (that
//    option only controls *optional* plugins), and the "bundled" export is
//    the real, documented knob for avoiding that runtime fetch entirely.
//    Per this package's own README ("Available exports"), the real usage
//    pattern is identical either way: `new rudderanalytics.RudderAnalytics()`
//    then `.load(writeKey, dataPlaneUrl, loadOptions)` -- the exported
//    member is a class, not a ready-to-call instance.
const vendorBundles: Record<string, { file: string; contentType: string }> = {
  "/vendor/posthog-js.js": {
    file: join(import.meta.dir, "node_modules/posthog-js/dist/array.js"),
    contentType: "application/javascript",
  },
  "/vendor/segment-analytics-next.js": {
    file: join(import.meta.dir, "node_modules/@segment/analytics-next/dist/umd/index.js"),
    contentType: "application/javascript",
  },
  "/vendor/rudderstack-analytics-js.js": {
    file: join(import.meta.dir, "node_modules/@rudderstack/analytics-js/dist/npm/modern/bundled/umd/index.js"),
    contentType: "application/javascript",
  },
};

// This workspace's own fixture HTML (issue 004) and the repo root's real,
// already-built `dist/` output -- same `/dist/*` mapping `e2e/server.ts`
// already uses for the same reason (verifying the actual built artifact,
// not a copy of it).
const repoRoot = join(import.meta.dir, "..");
const fixturesDir = join(import.meta.dir, "fixtures");

// Segment's CDN "integrations settings" fetch (`loadCDNSettings()` in
// `@segment/analytics-next/dist/cjs/browser/index.js`) requests exactly
// `${cdnURL}/v1/projects/${writeKey}/settings` and then reads
// `response.integrations['Segment.io']` unguarded (no optional chaining on
// the container itself) -- the generic catch-all 200 below would satisfy
// `res.ok` but its body has no `integrations` key at all, which throws a
// `TypeError` inside the SDK and never fires its ready promise. This route
// returns the minimal real shape Segment's own `CDNSettings`/
// `RemoteSegmentIOIntegrationSettings` types require, with `Segment.io`'s
// own `apiHost` pointed back at this same stub (via the request's own `Host`
// header, since the port is chosen dynamically by `startStubServer(0)` in
// tests) -- so even a real `track()` call's actual ingestion request would
// stay on localhost, not just the settings fetch itself.
const segmentSettingsPath = /^\/v1\/projects\/[^/]+\/settings$/;

// RudderStack's source-config fetch (`getSourceConfigURL()` in
// `@rudderstack/analytics-js/dist/npm/modern/umd/index.js`) always resolves
// to `<configUrl-origin>/sourceConfig/` (it appends the trailing-slash
// `/sourceConfig/` segment when the configured URL's own path doesn't
// already end in `/sourceConfig`) and validates the response via
// `isValidSourceConfig()`, which requires `res.source` to be an object with
// a defined `.id`, an object `.config`, and an array `.destinations` --
// the generic catch-all 200 body fails all three checks, which the SDK
// treats as a fatal `SOURCE_CONFIG_RESOLUTION_ERROR` and never calls
// `ready()`. This route returns the minimal valid shape, with an empty
// `destinations` array so no device-mode destination plugin ever attempts
// to auto-load (this fixture's "destination-plugin auto-loading" disable,
// alongside `loadIntegration: false` in `rudderstack.html`'s load options).
const rudderstackSourceConfigPath = /^\/sourceConfig\/?$/;

export function startStubServer(port = 0): StubServer {
  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const vendor = vendorBundles[url.pathname];
      if (vendor) {
        const file = Bun.file(vendor.file);
        if (await file.exists()) {
          return new Response(file, { headers: { "Content-Type": vendor.contentType } });
        }
        return new Response("vendor bundle not found", { status: 404 });
      }

      if (url.pathname.startsWith("/dist/")) {
        const file = Bun.file(join(repoRoot, url.pathname));
        if (await file.exists()) {
          return new Response(file, { headers: { "Content-Type": "application/javascript" } });
        }
        return new Response("dist artifact not found -- run `bun run build` at the repo root first", {
          status: 404,
        });
      }

      if (segmentSettingsPath.test(url.pathname)) {
        const host = req.headers.get("host") ?? url.host;
        return Response.json({
          integrations: {
            "Segment.io": {
              apiKey: "stub-write-key",
              apiHost: `${host}/v1`,
              protocol: "http",
              retryQueue: false,
            },
          },
        });
      }

      if (rudderstackSourceConfigPath.test(url.pathname)) {
        return Response.json({
          source: {
            id: "stub-source",
            name: "stub",
            workspaceId: "stub-workspace",
            enabled: true,
            config: {},
            destinations: [],
          },
        });
      }

      // Fixture HTML pages (issue 004) -- `benchmarks/fixtures/*.html`,
      // served as real files (not the catch-all stub below) so Playwright's
      // `page.goto()` gets real page content to load and execute.
      if (req.method === "GET" && !url.pathname.includes("..")) {
        const fixtureFile = Bun.file(join(fixturesDir, url.pathname === "/" ? "index.html" : url.pathname));
        if (await fixtureFile.exists()) {
          return new Response(fixtureFile);
        }
      }

      // Any other path/method: this is the "ingestion endpoint" every
      // vendor fixture points at -- respond 200 immediately, no processing.
      return Response.json({ status: "ok" });
    },
  });
}

export function stopStubServer(server: StubServer): void {
  server.stop(true);
}

// Only starts a real, listening server as a side effect when this file is
// run directly (`bun run stub-server.ts`, exactly the shell command
// `benchmarks/playwright.config.ts`'s `webServer.command` uses) -- importing
// `startStubServer`/`stopStubServer` elsewhere (this file's own
// `stub-server.test.ts`) never triggers this block, same "only run when
// executed directly" shape as `e2e/server.ts`'s bare top-level `Bun.serve()`
// (which has no importers to protect).
if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4320);
  const server = startStubServer(port);
  console.log(`benchmarks stub server listening on http://localhost:${server.port}`);
}
