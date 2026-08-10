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
// without a live CDN fetch.
//
// Exports startStubServer()/stopStubServer() rather than a bare top-level
// Bun.serve() call, so both the mitata suite (if it ever needs it) and the
// Playwright config (issues 004-005, via webServer.command exactly like
// e2e/playwright.config.ts already does) can start/stop it deterministically.

import { join } from "node:path";

type StubServer = ReturnType<typeof Bun.serve>;

// Resolved by hand against each package's own package.json main/module
// fields and dist/ layout (none of these three vendor packages publish an
// "unpkg" field) -- the real, script-tag-loadable browser bundle for each,
// not a guess:
//  - posthog-js: dist/array.js is the IIFE bundle PostHog's own snippet
//    loads from its CDN (`v.posthog=i` at the end sets `window.posthog`).
//  - @segment/analytics-next: dist/umd/standalone.js is the UMD "standalone"
//    bundle Segment's own snippet loads (sets `window.AnalyticsNext`).
//  - @rudderstack/analytics-js: dist/npm/modern/umd/index.js is the UMD
//    bundle that sets `global.rudderanalytics` (as opposed to the larger
//    dist/npm/modern/bundled/umd/index.js, which bundles in extra loader
//    machinery this comparison doesn't need).
const vendorBundles: Record<string, { file: string; contentType: string }> = {
  "/vendor/posthog-js.js": {
    file: join(import.meta.dir, "node_modules/posthog-js/dist/array.js"),
    contentType: "application/javascript",
  },
  "/vendor/segment-analytics-next.js": {
    file: join(import.meta.dir, "node_modules/@segment/analytics-next/dist/umd/standalone.js"),
    contentType: "application/javascript",
  },
  "/vendor/rudderstack-analytics-js.js": {
    file: join(import.meta.dir, "node_modules/@rudderstack/analytics-js/dist/npm/modern/umd/index.js"),
    contentType: "application/javascript",
  },
};

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

      // Any other path/method: this is the "ingestion endpoint" every
      // vendor fixture points at -- respond 200 immediately, no processing.
      return Response.json({ status: "ok" });
    },
  });
}

export function stopStubServer(server: StubServer): void {
  server.stop(true);
}
