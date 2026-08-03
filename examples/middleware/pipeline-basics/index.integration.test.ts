import { describe, expect, test } from "bun:test";
import { runPipelineBasicsFlow } from "./index";

// Runs the example's actual entry-point logic (`runPipelineBasicsFlow`, the
// exact function `bun run index.ts` calls) end-to-end against the real
// `typetrack` package, so every assertion below can never silently drift out
// of sync with what `README.md`/`expected-output.txt` document.

describe("pipeline-basics example", () => {
  test("scenario 1: basic usage + composition -- versionMiddleware/enrichmentMiddleware/redactMiddleware all land on the delivered event", async () => {
    const { goodPipelineCallLog } = await runPipelineBasicsFlow();

    const checkoutStarted = goodPipelineCallLog.find((entry) => entry.eventName === "Checkout Started");
    expect(checkoutStarted).toBeDefined();
    expect(checkoutStarted!.outcome).toBe("delivered");
    // versionMiddleware (basic usage): injected into metadata.
    expect(checkoutStarted!.metadata).toEqual({ appVersion: "2.4.0", buildId: "b9137" });
    // enrichmentMiddleware ran before redactMiddleware: emailDomain is
    // derived from the still-unredacted email.
    expect(checkoutStarted!.properties.emailDomain).toBe("example.com");
    // redactMiddleware: the raw email itself never reaches the provider.
    expect(checkoutStarted!.properties.email).toBe("[REDACTED]");
    expect(checkoutStarted!.properties.cartValue).toBe(89.5);
    expect(checkoutStarted!.properties.itemCount).toBe(2);
  });

  test("scenario 1: execution order -- every before-phase log precedes the provider's receipt, which precedes every after-phase log", async () => {
    const { sink } = await runPipelineBasicsFlow();

    const beforeLoggingIndex = sink.indexOf('typetrack: [before] "Checkout Started" {"email":"jane.doe@example.com","cartValue":89.5,"itemCount":2}');
    const beforeTraceStartIndex = sink.indexOf('[before] trace:start "Checkout Started"');
    const beforeTraceEndIndex = sink.indexOf('[before] trace:end "Checkout Started"');
    const providerReceivedIndex = sink.findIndex((line) => line.startsWith('[provider] checkout-events-warehouse received "Checkout Started"'));
    const afterLoggingIndex = sink.indexOf('typetrack: [after] "Checkout Started" dispatched');
    const afterTraceStartIndex = sink.indexOf('[after] trace:start "Checkout Started"');
    const afterTraceEndIndex = sink.indexOf('[after] trace:end "Checkout Started"');

    expect(beforeLoggingIndex).toBeGreaterThanOrEqual(0);
    expect(beforeTraceStartIndex).toBeGreaterThanOrEqual(0);
    expect(beforeTraceEndIndex).toBeGreaterThanOrEqual(0);
    expect(providerReceivedIndex).toBeGreaterThanOrEqual(0);
    expect(afterLoggingIndex).toBeGreaterThanOrEqual(0);
    expect(afterTraceStartIndex).toBeGreaterThanOrEqual(0);
    expect(afterTraceEndIndex).toBeGreaterThanOrEqual(0);

    // before(all, in registration order) -> dispatch -> after(all, in
    // registration order): logging, trace:start, [order-value-guard,
    // version, enrichment, redact -- none of which log], trace:end.
    expect(beforeLoggingIndex).toBeLessThan(beforeTraceStartIndex);
    expect(beforeTraceStartIndex).toBeLessThan(beforeTraceEndIndex);
    expect(beforeTraceEndIndex).toBeLessThan(providerReceivedIndex);
    expect(providerReceivedIndex).toBeLessThan(afterLoggingIndex);
    expect(afterLoggingIndex).toBeLessThan(afterTraceStartIndex);
    expect(afterTraceStartIndex).toBeLessThan(afterTraceEndIndex);
  });

  test("scenario 2: composition order matters -- swapping enrichment/redact registration order changes the delivered emailDomain", async () => {
    const { wrongOrderCallLog } = await runPipelineBasicsFlow();

    const checkoutStarted = wrongOrderCallLog.find((entry) => entry.eventName === "Checkout Started");
    expect(checkoutStarted).toBeDefined();
    // redactMiddleware ran first this time: by the time enrichment's
    // function runs, email is already "[REDACTED]" (no "@"), so emailDomain
    // falls back to "unknown" instead of the correct "example.com".
    expect(checkoutStarted!.properties.emailDomain).toBe("unknown");
    expect(checkoutStarted!.properties.email).toBe("[REDACTED]");
  });

  test('scenario 3: a middleware\'s before() throwing drops the event before dispatch and fires onError with source "middleware"', async () => {
    const { sink, goodPipelineCallLog } = await runPipelineBasicsFlow();

    // The provider never receives this event at all -- the chain stopped at
    // the throwing middleware, before dispatch.
    expect(goodPipelineCallLog.some((entry) => entry.eventName === "Purchase Completed")).toBe(false);

    expect(sink).toContain(
      'typetrack: [error] "Purchase Completed" (source: middleware): order-value-guard: invalid order value -50 for "Purchase Completed"',
    );
    // trace:end (registered after order-value-guard) never ran its before(),
    // and no after-chain ran at all for this event -- confirming the
    // before-chain's short-circuit.
    expect(sink).not.toContain('[before] trace:end "Purchase Completed"');
    expect(sink).not.toContain('[after] trace:start "Purchase Completed"');
    expect(sink).not.toContain('[after] trace:end "Purchase Completed"');
  });

  test('scenario 4: a provider dispatch rejection is swallowed, fires onError with source "provider" and the correct providerName, and the after-chain still runs', async () => {
    const { sink, goodPipelineCallLog } = await runPipelineBasicsFlow();

    const paymentEntry = goodPipelineCallLog.find((entry) => entry.eventName === "Payment Method Charged");
    expect(paymentEntry).toBeDefined();
    expect(paymentEntry!.outcome).toBe("rejected");

    expect(sink).toContain(
      'typetrack: [error] "Payment Method Charged" (source: provider, provider: checkout-events-warehouse): downstream API returned 500 for "Payment Method Charged"',
    );
    // The after-chain runs to completion despite the provider's rejection --
    // distinct from scenario 3's before-chain short-circuit.
    expect(sink).toContain('typetrack: [after] "Payment Method Charged" dispatched');
    expect(sink).toContain('[after] trace:start "Payment Method Charged"');
    expect(sink).toContain('[after] trace:end "Payment Method Charged"');
  });

  test("runPipelineBasicsFlow resolves without throwing (both error scenarios are fully swallowed by typetrack)", async () => {
    await expect(runPipelineBasicsFlow()).resolves.toBeDefined();
  });
});
