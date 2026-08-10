import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startStubServer, stopStubServer } from "./stub-server";

let baseUrl: string;
let server: ReturnType<typeof startStubServer>;

beforeAll(() => {
  server = startStubServer(0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  stopStubServer(server);
});

describe("catch-all ingestion stub", () => {
  test("responds 200 fast to an arbitrary GET path", async () => {
    const start = performance.now();
    const res = await fetch(`${baseUrl}/any/random/path`);
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });

  test("responds 200 fast to an arbitrary POST, regardless of body", async () => {
    const res = await fetch(`${baseUrl}/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    });

    expect(res.status).toBe(200);
  });

  test("responds 200 to arbitrary methods (PUT, DELETE)", async () => {
    const putRes = await fetch(`${baseUrl}/anything`, { method: "PUT" });
    const deleteRes = await fetch(`${baseUrl}/anything`, { method: "DELETE" });

    expect(putRes.status).toBe(200);
    expect(deleteRes.status).toBe(200);
  });
});

describe("vendor static bundle routes", () => {
  test.each([
    ["/vendor/posthog-js.js", "posthog"],
    ["/vendor/segment-analytics-next.js", "AnalyticsNext"],
    ["/vendor/rudderstack-analytics-js.js", "rudderanalytics"],
  ])("%s resolves to a real, non-empty file with a JS content-type", async (path, globalName) => {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(body.length).toBeGreaterThan(1000);
    // A loose sanity check that this is really the vendor's own bundle
    // (each sets a recognizable browser global), not an accidental
    // mismatch of file paths.
    expect(body).toContain(globalName);
  });

  test("unknown /vendor/* path falls through to the catch-all 200, not a 404", async () => {
    const res = await fetch(`${baseUrl}/vendor/does-not-exist.js`);
    expect(res.status).toBe(200);
  });
});
