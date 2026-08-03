import {
  createAnalytics,
  enrichmentMiddleware,
  loggingMiddleware,
  redactMiddleware,
  versionMiddleware,
  type Analytics,
  type AnalyticsProvider,
  type Middleware,
} from "typetrack";

// A single realistic checkout flow, run through a 6-middleware pipeline, that
// demonstrates every facet Phase 8's middleware brief requires an example to
// cover: basic usage, order-dependent composition, execution order, and both
// error-handling scenarios (a middleware throw and a provider rejection).
// Every log line below (`sink`) is produced by an actual `typetrack` run --
// nothing here is a hand-authored transcript -- so `index.integration.test.ts`
// can assert against it directly and `expected-output.txt` is a literal
// capture of `bun run index.ts`'s stdout.

export interface CallLogEntry {
  eventName: string;
  properties: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  outcome: "delivered" | "rejected";
}

// Renders a `loggingMiddleware`-style `(message, data?)` call into one
// human-readable line, pushes it into `sink` (for assertions), and mirrors it
// to `console.log` (so `bun run index.ts`'s stdout matches `sink` exactly,
// line for line, module-wide). `Error` values render as `message: reason`
// rather than `JSON.stringify`-ing an `Error` (which serializes to `"{}"`,
// losing the actual failure reason).
function makeLog(sink: string[]): (message: string, data?: unknown) => void {
  return (message, data) => {
    let line = message;
    if (data !== undefined) {
      line += data instanceof Error ? `: ${data.message}` : ` ${JSON.stringify(data)}`;
    }
    sink.push(line);
    console.log(line);
  };
}

// A hand-written stub provider standing in for a real analytics warehouse.
// Its `track()` rejects for any event name listed in `failOnEventNames`,
// simulating a downstream API outage -- this is what scenario 4 below
// (provider-dispatch rejection) exercises. Every call (success or failure)
// is recorded into `callLog` (structured, for assertions) and `sink`/console
// (human-readable, for the example's narrative output).
export function createCheckoutWarehouseProvider(
  callLog: CallLogEntry[],
  sink: string[],
  options?: { failOnEventNames?: string[] },
): AnalyticsProvider {
  const failOn = new Set(options?.failOnEventNames ?? []);
  const log = makeLog(sink);

  return {
    name: "checkout-events-warehouse",
    capabilities: {
      identify: false,
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
      if (failOn.has(event.name)) {
        callLog.push({ eventName: event.name, properties: event.properties, metadata: event.metadata, outcome: "rejected" });
        log(`[provider] checkout-events-warehouse: dispatch failed for "${event.name}" (simulated downstream 500)`);
        return Promise.reject(new Error(`downstream API returned 500 for "${event.name}"`));
      }
      callLog.push({ eventName: event.name, properties: event.properties, metadata: event.metadata, outcome: "delivered" });
      log(
        `[provider] checkout-events-warehouse received "${event.name}" ` +
          JSON.stringify({ properties: event.properties, metadata: event.metadata }),
      );
    },
  };
}

// A small custom middleware, purpose-built for this example, that logs its
// own name at both the `before` and `after` phase, doing nothing else (pure
// passthrough transform). None of the six built-ins log themselves (they are
// pure transforms/observers by design -- see their source comments), so a
// dedicated tracer like this is what makes the before(all)->dispatch->
// after(all) sequence literally visible in `sink`/console output, per the
// issue's "execution order" requirement.
function tracerMiddleware(name: string, sink: string[]): Middleware {
  const log = makeLog(sink);
  return {
    name,
    before(event) {
      log(`[before] ${name} "${event.name}"`);
      return event;
    },
    after(event) {
      log(`[after] ${name} "${event.name}"`);
    },
  };
}

// A purpose-built defensive-validation middleware: throws if `event
// .properties.value` (a monetary order amount, when present) is not a
// non-negative finite number. This is scenario 3's error-handling trigger --
// a realistic "malformed instrumentation data" guard, the kind of thing a
// real app might add to catch a bug in its own calling code before it
// reaches a paid vendor. Fields that don't carry a `value` at all (e.g.
// "Checkout Started"'s `cartValue`) are untouched -- this only ever inspects
// a field literally named `value`.
export function orderValueGuardMiddleware(): Middleware {
  return {
    name: "order-value-guard",
    before(event) {
      const value = event.properties.value;
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        throw new Error(`order-value-guard: invalid order value ${JSON.stringify(value)} for "${event.name}"`);
      }
      return event;
    },
  };
}

// Registers this example's full 7-middleware pipeline onto `analytics`, in
// one of two orders for the `enrichmentMiddleware`/`redactMiddleware` pair
// (see scenario 2 below for why the order matters). Every other middleware's
// position is fixed:
//
// 1. `loggingMiddleware` -- registered first, deliberately, so it is always
//    present in `ranMiddlewares` for any later throw (issue 003's fan-out
//    rule notifies the throwing middleware and everyone registered *before*
//    it -- a middleware registered after the throw is never notified for
//    it). Registering observability first is also good practice generally:
//    every event that even starts the pipeline gets logged.
// 2. `tracerMiddleware("trace:start", ...)` -- brackets the untraceable
//    built-ins that follow, for execution-order visibility.
// 3. `orderValueGuardMiddleware()` -- fails fast on malformed data, before
//    wasting effort on enrichment/redaction of an event that's about to be
//    thrown out anyway. Positioned after logging (so failures stay
//    observable) but before every transform.
// 4. `versionMiddleware` -- basic usage: injects `appVersion`/`buildId` into
//    `event.metadata`.
// 5/6. `enrichmentMiddleware` + `redactMiddleware`, in the order the caller
//    specifies (`order`).
// 7. `tracerMiddleware("trace:end", ...)`.
function registerPipeline(
  analytics: Analytics,
  sink: string[],
  order: "enrich-before-redact" | "redact-before-enrich",
): void {
  analytics.use(loggingMiddleware({ log: makeLog(sink) }));
  analytics.use(tracerMiddleware("trace:start", sink));
  analytics.use(orderValueGuardMiddleware());
  analytics.use(versionMiddleware({ appVersion: "2.4.0", buildId: "b9137" }));

  // Derives a non-sensitive `emailDomain` property from the event's `email`
  // property -- only meaningful if it runs *before* `email` has been
  // redacted (see scenario 2).
  const enrichment = enrichmentMiddleware({
    properties: (event) => {
      const email = event.properties.email;
      const domain = typeof email === "string" && email.includes("@") ? email.split("@")[1] : undefined;
      // Falls back to the literal string "unknown" (rather than leaving the
      // key `undefined`, which `JSON.stringify` would silently drop) so
      // scenario 2's broken output is visibly *wrong* ("unknown"), not just
      // silently missing -- a clearer contrast for the README/expected
      // output to point at.
      return { emailDomain: domain ?? "unknown" };
    },
  });
  const redact = redactMiddleware({ fields: ["email"] });

  if (order === "enrich-before-redact") {
    analytics.use(enrichment);
    analytics.use(redact);
  } else {
    analytics.use(redact);
    analytics.use(enrichment);
  }

  analytics.use(tracerMiddleware("trace:end", sink));
}

export interface PipelineBasicsResult {
  // Every log line produced across all 4 scenarios, in the exact order
  // `bun run index.ts` prints them -- this is what `expected-output.txt`
  // captures verbatim.
  sink: string[];
  // What the "good" (production) pipeline's provider actually received, in
  // call order -- scenarios 1, 3, and 4 all run through this one pipeline.
  goodPipelineCallLog: CallLogEntry[];
  // What the deliberately-misordered contrast pipeline's provider received
  // -- scenario 2 only.
  wrongOrderCallLog: CallLogEntry[];
}

// The example's real entry point: a checkout app's analytics pipeline,
// investigated scenario by scenario. Exported (rather than only run inline)
// so `index.integration.test.ts` runs this exact function.
export async function runPipelineBasicsFlow(): Promise<PipelineBasicsResult> {
  const sink: string[] = [];
  const goodPipelineCallLog: CallLogEntry[] = [];
  const wrongOrderCallLog: CallLogEntry[] = [];

  // The "good" pipeline: correct enrich-before-redact order, and the one
  // provider configured to fail for "Payment Method Charged" (scenario 4).
  const provider = createCheckoutWarehouseProvider(goodPipelineCallLog, sink, {
    failOnEventNames: ["Payment Method Charged"],
  });
  const analytics = createAnalytics({ provider });
  registerPipeline(analytics, sink, "enrich-before-redact");

  console.log('=== Scenario 1: basic usage, composition, and execution order ("Checkout Started") ===');
  await analytics.track("Checkout Started", {
    email: "jane.doe@example.com",
    cartValue: 89.5,
    itemCount: 2,
  });

  console.log('\n=== Scenario 2: composition order matters (contrast pipeline, same event) ===');
  const wrongOrderProvider = createCheckoutWarehouseProvider(wrongOrderCallLog, sink);
  const wrongOrderAnalytics = createAnalytics({ provider: wrongOrderProvider });
  registerPipeline(wrongOrderAnalytics, sink, "redact-before-enrich");
  await wrongOrderAnalytics.track("Checkout Started", {
    email: "jane.doe@example.com",
    cartValue: 89.5,
    itemCount: 2,
  });

  console.log('\n=== Scenario 3: middleware before() throws -> onError(source: "middleware") ===');
  await analytics.track("Purchase Completed", { value: -50, currency: "USD" });

  console.log('\n=== Scenario 4: provider dispatch rejects -> onError(source: "provider") ===');
  await analytics.track("Payment Method Charged", { value: 149.99, currency: "USD", method: "card" });

  return { sink, goodPipelineCallLog, wrongOrderCallLog };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runPipelineBasicsFlow();
}
