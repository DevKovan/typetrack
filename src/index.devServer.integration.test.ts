import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { createAnalytics } from "./index";
import { startDevServer, type DevServerHandle } from "./devServer/server";

const eventSchemas = {
  signup_completed: z.object({ plan: z.enum(["free", "pro"]) }),
} satisfies Record<string, z.ZodType>;

type AppEvents = {
  signup_completed: { plan: string };
};

let handle: DevServerHandle | undefined;

afterEach(async () => {
  if (handle) {
    await handle.stop();
    handle = undefined;
  }
});

interface RecordedDevServerEvent {
  event: string;
  payload: unknown;
  valid: boolean;
}

async function pollUntil<T>(check: () => Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("createAnalytics({ devServer }) against a real startDevServer()", () => {
  it("mirrors both a valid and an invalid tracked event to the real running dev server, flagged correctly", async () => {
    handle = await startDevServer({ startPort: 4950 });
    handle.setSchemas(eventSchemas);

    const analytics = createAnalytics<AppEvents>({
      devServer: { url: `${handle.url}/events` },
      schemas: eventSchemas,
    });

    analytics.track("signup_completed", { plan: "pro" });

    let thrown: unknown;
    try {
      analytics.track("signup_completed", {
        plan: "enterprise" as AppEvents["signup_completed"]["plan"],
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();

    const events = await pollUntil(async () => {
      const response = await fetch(`${handle!.url}/events`);
      const current = (await response.json()) as RecordedDevServerEvent[];
      return current.length >= 2 ? current : undefined;
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: "signup_completed",
      payload: { plan: "pro" },
      valid: true,
    });
    expect(events[1]).toMatchObject({
      event: "signup_completed",
      payload: { plan: "enterprise" },
      valid: false,
    });
  });
});
