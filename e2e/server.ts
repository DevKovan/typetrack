// Tiny static-file + request-logging server for this package's Playwright
// specs. Playwright's own `webServer` config (`playwright.config.ts`) starts
// and stops this process automatically -- nothing here needs manual
// lifecycle management (per plan/phase-16-testing-infrastructure/006-
// playwright-e2e.md's scope: "Playwright's own `webServer` config option to
// serve `e2e/fixtures/` as static files ... lifecycle is Playwright-managed,
// not a hand-rolled server process you must start/stop yourself").
//
// Serves two things from one process:
//  - Fixture HTML pages (`e2e/fixtures/*.html`), and, via `/dist/*`, this
//    repo's own real, root-built `dist/index.global.js` (requires `bun run
//    build` at the repo root to have already produced it -- see README.md).
//    Not a copy of that artifact -- a real path into the repo's own `dist/`.
//  - A tiny in-memory request log (`POST`/`GET` `/log`) so specs can observe,
//    from Playwright's own Node-side test process (via `page.request`/
//    `request`, a real HTTP client independent of the page under test),
//    requests the fixture page's own in-browser code made -- both a plain
//    `fetch()` (`global-bundle.spec.ts`) and a `navigator.sendBeacon()` spy
//    fired during real page teardown (`flush-on-unload.spec.ts`, where the
//    page itself may already be gone by the time the assertion runs, so
//    polling a server-side log rather than reading page state back out is
//    the only reliable option).

import { join } from "node:path";

const port = Number(process.env.PORT ?? 4319);
const repoRoot = join(import.meta.dir, "..");
const fixturesDir = join(import.meta.dir, "fixtures");

interface LogEntry {
  kind: string;
  body: unknown;
  receivedAt: number;
}

// Module-level, in-memory, never persisted -- this process's entire
// lifetime is exactly one Playwright test run (started/stopped by
// `webServer`), so there is nothing to clean up between runs. Tests filter
// by their own generated `requestId` rather than clearing this array
// between tests, so parallel specs sharing this one server process never
// race against each other's log entries.
const log: LogEntry[] = [];

function extractRequestId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.requestId === "string") return record.requestId;
  if (typeof record.payload === "object" && record.payload !== null) {
    const payloadId = (record.payload as Record<string, unknown>).requestId;
    if (typeof payloadId === "string") return payloadId;
  }
  return undefined;
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/log") {
      if (req.method === "POST") {
        const text = await req.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }
        log.push({ kind: url.searchParams.get("kind") ?? "unknown", body, receivedAt: Date.now() });
        return new Response("ok");
      }
      if (req.method === "GET") {
        const requestId = url.searchParams.get("requestId");
        const kind = url.searchParams.get("kind");
        const entries = log.filter((entry) => {
          if (kind && entry.kind !== kind) return false;
          if (requestId && extractRequestId(entry.body) !== requestId) return false;
          return true;
        });
        return Response.json(entries);
      }
    }

    const filePath = url.pathname.startsWith("/dist/")
      ? join(repoRoot, url.pathname)
      : join(fixturesDir, url.pathname === "/" ? "index.html" : url.pathname);

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`e2e fixture server listening on http://localhost:${port}`);
