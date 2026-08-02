import { createAnalytics, type AnalyticsProvider, type ProviderEntry } from "typetrack";

// Every entry in the log below records which provider was invoked, for
// which verb, and (for `track()`) which event -- this is what lets both the
// human-readable console output *and* `index.integration.test.ts`'s
// assertions observe routing/priority/sampling decisions from the outside.
// `typetrack` never exposes *why* a provider was (not) called (routing is
// evaluated entirely inside `createAnalytics()`), so "did the provider get
// invoked" is the only observable signal -- exactly what real production
// code would see too.
export interface CallLogEntry {
  provider: string;
  verb: "track" | "identify" | "flush" | "destroy";
  eventName?: string;
}

export interface ProviderSet {
  entries: ProviderEntry[];
  callLog: CallLogEntry[];
  providers: {
    analyticsWarehouseProvider: AnalyticsProvider;
    marketingPixelProvider: AnalyticsProvider;
    debugConsoleProvider: AnalyticsProvider;
    fullFeaturedProvider: AnalyticsProvider;
  };
}

// Builds a fresh set of 4 hand-written stub providers plus their routing
// config -- fresh on every call (rather than shared module-level constants)
// so two separate `createAnalytics()` instances (two simulated users, see
// `runRoutingFlow`'s two calls below) never share a `callLog`/`calls` array.
// `userLabel` only affects the console-log prefix, never `provider.name`
// (which stays vendor-flavored and stable, exactly as a real provider's
// would).
export function createProviderSet(userLabel: string): ProviderSet {
  const callLog: CallLogEntry[] = [];

  function makeStubProvider(name: string): AnalyticsProvider {
    return {
      name,
      capabilities: {
        identify: true,
        group: false,
        alias: false,
        page: false,
        screen: false,
        batching: false,
        offline: false,
        featureFlags: false,
        sessionReplay: false,
        heatmaps: false,
      },
      track(event) {
        callLog.push({ provider: name, verb: "track", eventName: event.name });
        console.log(`[${userLabel}] [${name}] track "${event.name}"`);
      },
      identify(userId, _traits, anonymousId) {
        callLog.push({ provider: name, verb: "identify" });
        console.log(`[${userLabel}] [${name}] identify userId=${userId} anonymousId=${anonymousId}`);
      },
      async flush() {
        callLog.push({ provider: name, verb: "flush" });
        console.log(`[${userLabel}] [${name}] flush`);
      },
      async destroy() {
        callLog.push({ provider: name, verb: "destroy" });
        console.log(`[${userLabel}] [${name}] destroy`);
      },
    };
  }

  // A data-warehouse-flavored provider that only wants commerce events --
  // routed via `include`, so every event *not* named exactly "Purchase
  // Completed" or "Checkout Started" is silently skipped for it.
  const analyticsWarehouseProvider = makeStubProvider("analytics-warehouse");

  // A marketing-pixel-flavored provider that wants everything *except*
  // internal debug instrumentation -- routed via `exclude`, matched against
  // a glob-free `RegExp` (`/^debug\./`) rather than `include`, since
  // same-provider `include` + `exclude` throws at construction (a *different*
  // provider than #1 above is required to demonstrate `exclude`).
  const marketingPixelProvider = makeStubProvider("marketing-pixel");

  // A local dev-console-flavored provider that only wants events fired while
  // the app is running in a development environment -- routed via a
  // `predicate` inspecting `event.context.environment`, a realistic
  // request-scoped field an app might attach via `TrackOptions.context`
  // (not a special/reserved core field -- an ordinary application-chosen
  // key inside `context`).
  const debugConsoleProvider = makeStubProvider("debug-console");

  // A "send everything, but only to half our users" flavored provider --
  // routed via `sampling`, deterministic per `anonymousId` (see
  // `shouldRouteToProvider`/`isSampledIn` in `src/routing.ts`): every event
  // in one call to `runRoutingFlow` shares the same `anonymousId`, so this
  // provider either receives *all* of that flow's `track()` calls or *none*
  // of them -- never some.
  const fullFeaturedProvider = makeStubProvider("full-featured");

  const entries: ProviderEntry[] = [
    {
      provider: analyticsWarehouseProvider,
      include: ["Purchase Completed", "Checkout Started"],
      priority: 30,
    },
    {
      provider: marketingPixelProvider,
      exclude: [/^debug\./],
      priority: 10,
    },
    {
      provider: debugConsoleProvider,
      predicate: (event) => event.context?.environment === "development",
      priority: 20,
    },
    {
      provider: fullFeaturedProvider,
      sampling: 0.5,
      priority: 0,
    },
  ];

  return {
    entries,
    callLog,
    providers: { analyticsWarehouseProvider, marketingPixelProvider, debugConsoleProvider, fullFeaturedProvider },
  };
}

// The realistic "app" logic: a mix of commerce events (some in production,
// some flagged as fired from a development environment), one internal
// debug-namespaced event, a plain pageview, an `identify()` call, and a
// `flush()` at shutdown. Exported (rather than only run inline) so
// `index.integration.test.ts` can run the exact same call sequence against
// its own `createProviderSet()` output. (Each stub provider still
// implements `destroy()`, as any real provider would, even though this flow
// never calls `analytics.destroy()` -- see the comment above `flush()`
// below for why.)
export async function runRoutingFlow(entries: ProviderEntry[]): Promise<void> {
  const analytics = createAnalytics({ provider: entries });

  // Commerce event, fired from a development environment: matches
  // `analyticsWarehouseProvider`'s `include`, is not excluded by
  // `marketingPixelProvider`'s `exclude`, and matches `debugConsoleProvider`'s
  // `predicate` -- the one call in this flow where 3 of the 4 providers are
  // *guaranteed* included (the 4th, `fullFeaturedProvider`, only sometimes,
  // per `sampling`), which is what makes it useful for observing priority
  // call order below.
  await analytics.track(
    "Checkout Started",
    { cartValue: 89.5, itemCount: 2 },
    { context: { environment: "development" } },
  );

  // Commerce event, fired from production: still matches `include`/`exclude`
  // the same way as above, but *fails* `debugConsoleProvider`'s predicate
  // (environment is "production", not "development").
  await analytics.track(
    "Purchase Completed",
    { value: 149.99, currency: "USD" },
    { context: { environment: "production" } },
  );

  // Internal debug-namespaced event: excluded by `marketingPixelProvider`,
  // not matched by `analyticsWarehouseProvider`'s `include`, but *does*
  // match `debugConsoleProvider`'s predicate (development environment).
  await analytics.track(
    "debug.cache_miss",
    { key: "pricing_page" },
    { context: { environment: "development" } },
  );

  // Plain pageview-style event with no `context` at all: not commerce
  // (fails `include`), not debug-namespaced (passes `exclude`), and fails
  // `debugConsoleProvider`'s predicate (`event.context` is `undefined`).
  await analytics.track("Page Viewed", { path: "/pricing" });

  // `identify()` always fans out to every provider in the array,
  // unconditionally -- routing (`include`/`exclude`/`predicate`/`sampling`)
  // only ever applies to `track()`/`page()`/`screen()`.
  await analytics.identify("user_88", { plan: "growth", role: "admin" });

  // `flush()` on a multi-provider array can reject with a real
  // `AggregateError` combining every failed provider's rejection reason --
  // real apps should catch and log it (as done here) rather than letting it
  // propagate uncaught. None of this example's stub providers ever actually
  // fail, so this `catch` block never runs in practice. (`destroy()` isn't
  // called here -- it internally flushes every provider again before tearing
  // it down, which would double up every provider's flush call in the
  // output below for no illustrative benefit; a real app's shutdown path
  // would call `destroy()` once, without a preceding explicit `flush()`.)
  try {
    await analytics.flush();
  } catch (error) {
    console.error("typetrack: flush() failed for one or more providers ->", error);
  }
}

// Prints, for one already-run `ProviderSet`, whether `fullFeaturedProvider`
// (the only provider whose inclusion depends on `anonymousId`, via
// `sampling`) landed "in" or "out" for this simulated user, and the observed
// call order for the one event ("Checkout Started") where every
// non-sampling provider is guaranteed included -- both purely by *observing*
// `callLog` (which providers were actually invoked, and in what order), not
// by re-deriving the routing/sampling decision independently. `typetrack`
// deliberately does not expose *why* a provider was/wasn't called, so this
// is exactly what a real caller could introspect too.
function logSamplingAndOrder(userLabel: string, callLog: CallLogEntry[]): void {
  const fullFeaturedTrackCalls = callLog.filter(
    (entry) => entry.provider === "full-featured" && entry.verb === "track",
  ).length;
  console.log(
    `[${userLabel}] full-featured sampling decision: ${fullFeaturedTrackCalls > 0 ? "IN" : "OUT"} ` +
      `(${fullFeaturedTrackCalls}/4 track calls received)`,
  );

  const checkoutOrder = callLog
    .filter((entry) => entry.verb === "track" && entry.eventName === "Checkout Started")
    .map((entry) => entry.provider);
  console.log(`[${userLabel}] call order for "Checkout Started": ${checkoutOrder.join(" -> ")}`);
}

// Only runs against two real, separately-constructed simulated users when
// this file is executed directly (`bun run index.ts`) -- not when imported
// by `index.integration.test.ts`. Two separate `createAnalytics()` instances
// are used (rather than one instance reused twice) because `anonymousId`
// isn't settable post-construction -- each instance generates its own,
// independently random, `anonymousId` the moment it's constructed, which is
// exactly what simulates two distinct real users/devices.
if (import.meta.main) {
  console.log("=== Simulated user A ===");
  const userA = createProviderSet("user-A");
  await runRoutingFlow(userA.entries);
  logSamplingAndOrder("user-A", userA.callLog);

  console.log("\n=== Simulated user B ===");
  const userB = createProviderSet("user-B");
  await runRoutingFlow(userB.entries);
  logSamplingAndOrder("user-B", userB.callLog);
}
