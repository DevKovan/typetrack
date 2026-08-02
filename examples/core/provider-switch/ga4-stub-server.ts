// A minimal local stand-in for GA4's Measurement Protocol endpoint, built on
// Bun's native `Bun.serve()`. Used by `run-with-ga4-local-stub.ts` (a manual,
// safe dry run) and by `app.integration.test.ts` (automated assertions).
// Never talks to real Google infrastructure -- `port: 0` binds an
// OS-assigned local port.
// Not exported -- only consumed internally by `GA4Stub.requests` below;
// callers read the recorded requests off that field rather than importing
// this shape directly.
interface GA4StubRequest {
  method: string;
  pathname: string;
  searchParams: Record<string, string>;
  body: unknown;
}

export interface GA4Stub {
  url: string;
  requests: GA4StubRequest[];
  stop(): void;
}

export function startGA4Stub(): GA4Stub {
  const requests: GA4StubRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.json() : undefined;
      requests.push({
        method: req.method,
        pathname: url.pathname,
        searchParams: Object.fromEntries(url.searchParams),
        body,
      });
      return new Response(null, { status: 204 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop() {
      server.stop(true);
    },
  };
}
