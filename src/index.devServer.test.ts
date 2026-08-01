import { afterEach, describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { createAnalytics } from "./index";
import type { AnalyticsProvider } from "./providers";

type SampleEvents = {
  signup_completed: { plan: string; source: string };
  page_viewed: { path: string };
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchFn) {
  const fetchStub = mock<FetchFn>(impl);
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  return fetchStub;
}

describe("createAnalytics({ devServer }) unit tests", () => {
  it("with devServer unset, never calls fetch for any track() call", () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));

    const track = mock<AnalyticsProvider["track"]>(() => {});
    const provider: AnalyticsProvider = { name: "test", track };
    const analytics = createAnalytics<SampleEvents>({ provider });

    analytics.track("page_viewed", { path: "/" });
    analytics.track("signup_completed", { plan: "pro", source: "ad" });

    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("with devServer: true, posts to the default URL with a body containing the event name and raw payload", () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));

    const provider: AnalyticsProvider = { name: "test", track: mock(() => {}) };
    const analytics = createAnalytics<SampleEvents>({ provider, devServer: true });

    analytics.track("page_viewed", { path: "/home" });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4318/events");
    expect(JSON.parse(init!.body as string)).toEqual({
      event: "page_viewed",
      payload: { path: "/home" },
    });
  });

  it("with devServer: { url }, posts to exactly that URL", () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));

    const provider: AnalyticsProvider = { name: "test", track: mock(() => {}) };
    const analytics = createAnalytics<SampleEvents>({
      provider,
      devServer: { url: "http://localhost:9999/events" },
    });

    analytics.track("page_viewed", { path: "/home" });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url] = fetchStub.mock.calls[0]!;
    expect(url).toBe("http://localhost:9999/events");
  });

  it("track() returns synchronously without awaiting the dev POST, even when fetch hangs forever", () => {
    const fetchStub = stubFetch(() => new Promise<Response>(() => {}));

    const provider: AnalyticsProvider = { name: "test", track: mock(() => {}) };
    const analytics = createAnalytics<SampleEvents>({ provider, devServer: true });

    const result = analytics.track("page_viewed", { path: "/home" });

    expect(result).toBeUndefined();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("still fires the dev POST when schema validation fails and onValidationError swallows the error", () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));

    const onValidationError = mock(() => {});
    const analytics = createAnalytics<SampleEvents>({
      devServer: true,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
      onValidationError,
    });

    analytics.track("signup_completed", { plan: "enterprise", source: "ad" });

    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [, init] = fetchStub.mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({
      event: "signup_completed",
      payload: { plan: "enterprise", source: "ad" },
    });
  });

  it("still fires the dev POST when no onValidationError is set and track() throws", () => {
    const fetchStub = stubFetch(() => Promise.resolve(new Response(null, { status: 200 })));

    const analytics = createAnalytics<SampleEvents>({
      devServer: true,
      schemas: {
        signup_completed: z.object({ plan: z.enum(["free", "pro"]), source: z.string() }),
      },
    });

    expect(() =>
      analytics.track("signup_completed", { plan: "enterprise", source: "ad" }),
    ).toThrow();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("a rejected stubbed fetch never propagates out of track() and produces no default logging", () => {
    const fetchStub = stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));

    const originalConsoleError = console.error;
    const errorCalls: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };

    const provider: AnalyticsProvider = { name: "test", track: mock(() => {}) };
    const analytics = createAnalytics<SampleEvents>({ provider, devServer: true });

    let thrown: unknown;
    try {
      analytics.track("page_viewed", { path: "/home" });
    } catch (err) {
      thrown = err;
    }

    console.error = originalConsoleError;

    expect(thrown).toBeUndefined();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(errorCalls).toHaveLength(0);
  });
});
