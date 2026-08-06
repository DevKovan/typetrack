import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { startDevServer, type DevServerHandle } from "./server";

// Snapshot test -- not a correctness assertion (that's
// `server.integration.test.ts`'s job, which already asserts against
// `Object.keys(schemaBody.events)`), but a regression lock on the exact
// `z.toJSONSchema(schema)`-derived wire shape `GET /schema` returns: a real
// consumer-facing contract (anything polling `/schema`, per Phase 3's
// dev-server design) with no other regression coverage today beyond that ad
// hoc key-list assertion. Same real-HTTP-round-trip setup/teardown pattern
// as `server.integration.test.ts` (own `startPort`, not shared with any of
// that file's ports, to avoid a bind collision when both run in the same
// process).

const REPO_ROOT = join(import.meta.dir, "..", "..");

let handle: DevServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
  rmSync(join(REPO_ROOT, ".typetrack"), { recursive: true, force: true });
});

describe("GET /schema (snapshot)", () => {
  it("returns the locked-down z.toJSONSchema() shape for a small, representative multi-event schemas map", async () => {
    handle = await startDevServer({ startPort: 4940 });
    handle.setSchemas({
      signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
      page_viewed: z.object({ path: z.string(), referrer: z.string().optional() }),
      purchase_completed: z.object({
        orderId: z.string(),
        total: z.number(),
        currency: z.string().default("USD"),
      }),
    });

    const response = await fetch(`${handle.url}/schema`);
    const body = (await response.json()) as { events: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body).toMatchSnapshot();
  });
});
