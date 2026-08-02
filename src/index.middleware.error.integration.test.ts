// Integration test for issue 003: constructs a real `createAnalytics({
// provider: [...] })` against 3 hand-written `AnalyticsProvider` objects
// (one of which conditionally rejects `track()`), registers a realistic
// mix of middlewares (some with `onError`, one whose `before()` throws
// under a specific condition, one whose `after()` throws under a different
// condition), drives a realistic sequence of `track()` calls, and asserts
// the full per-middleware `onError`-received log (error, event, ctx)
// matches hand-computed expected outcomes across the whole sequence --
// alongside which providers actually received each call and which calls
// reached `after()`.
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "./index";
import type { Middleware } from "./middleware";
import type { AnalyticsProvider } from "./providers";
import type { CanonicalEvent } from "./schema";
import { allCapabilities } from "./test-support";

type OnErrorCall = {
  middleware: string;
  error: unknown;
  eventName: string;
  ctx: { source: "middleware" | "provider"; providerName?: string };
};

function makeRecordingProvider(
  name: string,
  shouldReject: (event: CanonicalEvent) => boolean,
): { provider: AnalyticsProvider; calls: CanonicalEvent[] } {
  const calls: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name,
    capabilities: allCapabilities,
    track(event) {
      calls.push(event);
      if (shouldReject(event)) {
        return Promise.reject(new Error(`${name} rejected "${event.name}"`));
      }
    },
    async flush() {},
    async destroy() {},
  };
  return { provider, calls };
}

const originalConsoleWarn = console.warn;
afterEach(() => {
  console.warn = originalConsoleWarn;
});

describe("createAnalytics() onError integration", () => {
  it("drives a realistic call sequence through 3 providers (one flaky) and 4 middlewares (one throwing before(), one throwing after()), matching hand-computed onError/after outcomes", async () => {
    console.warn = () => {}; // the existing per-rejection console.warn contract is unit-tested elsewhere.

    const ga4 = makeRecordingProvider("ga4", () => false);
    const segment = makeRecordingProvider("segment", (event) => event.name === "flaky_event");
    const posthog = makeRecordingProvider("posthog", () => false);

    const onErrorLog: OnErrorCall[] = [];
    function recordOnError(name: string): Pick<Middleware, "onError"> {
      return {
        onError(error, event, ctx) {
          onErrorLog.push({ middleware: name, error, eventName: event.name, ctx });
        },
      };
    }

    // Middleware 1: tags every event; no onError -- exercises "a middleware
    // without onError never appears in the onError log even when notified".
    const tagger: Middleware = {
      name: "tagger",
      before: (event) => ({ ...event, properties: { ...event.properties, tag: "web" } }),
    };

    // Middleware 2: throws in before() for events explicitly marked invalid.
    const invalidBoom = new Error("strictValidator: invalid event");
    const strictValidator: Middleware = {
      name: "strictValidator",
      before: (event) => {
        if (event.properties.invalid === true) {
          throw invalidBoom;
        }
        return event;
      },
      ...recordOnError("strictValidator"),
    };

    // Middleware 3: passthrough before(); throws in after() for a specific
    // event name (exercises the after()-throw short-circuit).
    const afterBoom = new Error("auditor: audit_fail after() failure");
    const auditor: Middleware = {
      name: "auditor",
      before: (event) => event,
      after: (event) => {
        if (event.name === "audit_fail") {
          throw afterBoom;
        }
      },
      ...recordOnError("auditor"),
    };

    // Middleware 4: records every event that reaches after() (registered
    // last -- never reached when an earlier middleware's before()/after()
    // throws first). No onError.
    const afterLog: string[] = [];
    const recorder: Middleware = {
      name: "recorder",
      after: (event) => void afterLog.push(event.name),
    };

    const analytics = createAnalytics({ provider: [ga4.provider, segment.provider, posthog.provider] });
    analytics.use(tagger);
    analytics.use(strictValidator);
    analytics.use(auditor);
    analytics.use(recorder);

    // -- drive a realistic sequence --
    await analytics.track("signup", { value: 1 }); // 1: clean -- dispatched, no errors.
    await analytics.track("flaky_event", { value: 2 }); // 2: segment rejects during dispatch.
    await analytics.track("bad_event", { invalid: true }); // 3: strictValidator's before() throws -- never dispatched.
    await analytics.track("audit_fail", {}); // 4: dispatched fine, auditor's after() throws.
    await analytics.track("flaky_event", { value: 5 }); // 5: segment rejects again.
    await analytics.track("clean_event", {}); // 6: clean -- dispatched, no errors.

    // -- hand-computed expected outcomes --

    // Every provider is attempted for every call except #3 (blocked by the
    // before()-throw, never reaches dispatch at all): 5 attempts each.
    for (const { calls } of [ga4, segment, posthog]) {
      expect(calls).toHaveLength(5);
      expect(calls.map((e) => e.name)).toEqual([
        "signup",
        "flaky_event",
        "audit_fail",
        "flaky_event",
        "clean_event",
      ]);
    }

    // after() only reaches "recorder" (registered last) for calls where
    // nothing upstream of it threw: #1, #2, #5, #6 -- not #3 (dropped via
    // throw before dispatch) and not #4 (auditor's after() threw first).
    expect(afterLog).toEqual(["signup", "flaky_event", "flaky_event", "clean_event"]);

    // onError log: only "strictValidator" and "auditor" ever appear
    // (they're the only middlewares with an onError handler) -- "tagger"
    // and "recorder" never appear even though they "ran" for various calls.
    expect(onErrorLog.every((entry) => entry.middleware === "strictValidator" || entry.middleware === "auditor")).toBe(
      true,
    );

    // Provider-rejection notifications (source: "provider"): fire on every
    // middleware with onError registered at the time of dispatch (both
    // strictValidator and auditor, since dispatch only happens after every
    // middleware's before() succeeded) -- once per failing provider dispatch
    // (#2 and #5, one failing provider each).
    const providerEntries = onErrorLog.filter((entry) => entry.ctx.source === "provider");
    expect(providerEntries).toHaveLength(4); // 2 middlewares x 2 flaky_event calls
    for (const entry of providerEntries) {
      expect(entry.ctx.providerName).toBe("segment");
      expect(entry.eventName).toBe("flaky_event");
      expect(String(entry.error)).toContain("segment rejected");
    }
    expect(providerEntries.filter((e) => e.middleware === "strictValidator")).toHaveLength(2);
    expect(providerEntries.filter((e) => e.middleware === "auditor")).toHaveLength(2);

    // before()-throw notification (#3): only "strictValidator" (the thrower
    // itself) -- "auditor" is registered after it and never ran its
    // before() for this call, so it is not notified.
    const middlewareEntries = onErrorLog.filter((entry) => entry.ctx.source === "middleware");
    const beforeThrowEntries = middlewareEntries.filter((entry) => entry.error === invalidBoom);
    expect(beforeThrowEntries).toEqual([
      { middleware: "strictValidator", error: invalidBoom, eventName: "bad_event", ctx: { source: "middleware" } },
    ]);

    // after()-throw notification (#4): both "strictValidator" (registered
    // before the thrower) and "auditor" (the thrower itself) -- "recorder"
    // (registered after) never runs its after() for this call, confirmed
    // above via afterLog.
    const afterThrowEntries = middlewareEntries.filter((entry) => entry.error === afterBoom);
    expect(afterThrowEntries).toHaveLength(2);
    expect(afterThrowEntries.map((e) => e.middleware).sort()).toEqual(["auditor", "strictValidator"]);
    for (const entry of afterThrowEntries) {
      expect(entry.eventName).toBe("audit_fail");
      expect(entry.ctx).toEqual({ source: "middleware" });
    }

    // Total onError call count across the whole sequence: 2 (call #2, one
    // per middleware) + 1 (call #3, strictValidator only) + 2 (call #4, both
    // middlewares) + 2 (call #5, one per middleware) = 7.
    expect(onErrorLog).toHaveLength(7);
  });
});
