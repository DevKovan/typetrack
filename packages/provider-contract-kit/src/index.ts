import { describe, expect, it } from "bun:test";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";

// Shared `AnalyticsProvider` interface-contract test suite (Phase 16 issue
// 001, `plan/phase-16-testing-infrastructure/001-provider-contract-kit.md`).
// Validates the interface's *shape and lifecycle contract* -- capability
// flags, method-presence invariants, resolve/no-throw guarantees, generic
// error propagation -- never vendor-specific wire-payload content (see
// BRIEF.md Design decision 1). Zero vendor deps beyond `typetrack` itself.

// Test-file-supplied harness -- this kit never constructs a provider's own
// transport stub itself (BRIEF.md Design decision 2). Each adapter's own
// contract test file builds this using whatever transport-stubbing approach
// that file already uses (stubbed `fetch`, hand-written fake SDK client,
// real local HTTP server -- the kit doesn't care).
export interface ProviderContractHarness {
  // Label used in this suite's own describe() block, e.g. "GA4",
  // "PostHog (SDK)", "PostHog (fetch)", "Segment (SDK)", "Segment (fetch)".
  name: string;
  // Constructs a fresh AnalyticsProvider whose transport (stubbed fetch,
  // fake SDK client -- whatever the caller's own test file already uses)
  // is wired to succeed. Called once per test that needs a healthy
  // provider -- never reused across tests, so no test can observe another
  // test's call history.
  createProvider(): AnalyticsProvider;
  // Constructs a fresh AnalyticsProvider whose transport is wired so that
  // any call track() makes against it rejects/throws (e.g. a stubbed
  // fetch returning a non-2xx response, or a fake client method that
  // throws). Used only by the "track() rejects when the transport fails"
  // test below.
  createFailingProvider(): AnalyticsProvider;
  // A minimal, valid CanonicalEvent this suite can pass to track()/page()/
  // screen() without triggering any adapter-specific validation/mapping
  // edge case the caller doesn't want exercised here (adapter-specific
  // mapping behavior is each package's own test file's job, not this
  // kit's).
  makeEvent(overrides?: Partial<CanonicalEvent>): CanonicalEvent;
}

// The five optional verbs whose presence/absence on the provider object is
// governed by a same-named `capabilities` flag. `track` is deliberately
// excluded -- it's non-optional on `AnalyticsProvider` and has no
// corresponding capability flag.
const OPTIONAL_CAPABILITY_METHODS = ["identify", "group", "alias", "page", "screen"] as const;

// Every `ProviderCapabilities` flag that is required (non-optional) and
// boolean-typed. `batch`/`runtimes` are checked separately below since both
// are optional and non-boolean-shaped (`runtimes` is `Array<string>`).
const REQUIRED_BOOLEAN_CAPABILITY_FLAGS = [
  "identify",
  "group",
  "alias",
  "page",
  "screen",
  "batching",
  "offline",
  "featureFlags",
  "sessionReplay",
  "heatmaps",
] as const;

async function assertCapabilitiesShape(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  const capabilities = provider.capabilities;
  expect(capabilities).toBeDefined();

  for (const flag of REQUIRED_BOOLEAN_CAPABILITY_FLAGS) {
    expect(typeof capabilities[flag]).toBe("boolean");
  }

  // `batch`/`runtimes` are optional per `ProviderCapabilities` -- absent is
  // valid, not a failure -- but when present must match their declared
  // shape.
  if (capabilities.batch !== undefined) {
    expect(typeof capabilities.batch).toBe("boolean");
  }
  if (capabilities.runtimes !== undefined) {
    expect(Array.isArray(capabilities.runtimes)).toBe(true);
    for (const runtime of capabilities.runtimes) {
      expect(typeof runtime).toBe("string");
    }
  }
}

async function assertCapabilityImpliesMethodPresence(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  for (const method of OPTIONAL_CAPABILITY_METHODS) {
    if (provider.capabilities[method] === true) {
      expect(typeof provider[method]).toBe("function");
    } else {
      expect(provider[method]).toBeUndefined();
    }
  }
}

async function assertProviderNameNonEmpty(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  expect(typeof provider.name).toBe("string");
  expect(provider.name.length).toBeGreaterThan(0);
}

async function assertTrackResolvesForHealthyTransport(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  // `track()`'s return type is `void | Promise<void>` -- wrap in
  // `Promise.resolve(...)` so this tolerates a synchronous provider too.
  await expect(Promise.resolve(provider.track(harness.makeEvent()))).resolves.toBeUndefined();
}

async function assertTrackRejectsForBrokenTransport(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createFailingProvider();
  // Tolerates both a synchronous throw and a rejected Promise.
  await expect(Promise.resolve().then(() => provider.track(harness.makeEvent()))).rejects.toThrow();
}

async function assertPageTolerantOfEmptyName(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  if (provider.capabilities.page) {
    await expect(Promise.resolve(provider.page?.(harness.makeEvent({ name: "" })))).resolves.toBeUndefined();
  }
}

async function assertScreenTolerantOfEmptyName(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  if (provider.capabilities.screen) {
    await expect(Promise.resolve(provider.screen?.(harness.makeEvent({ name: "" })))).resolves.toBeUndefined();
  }
}

async function assertLifecycleMethodsResolveWithoutThrowing(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  if (provider.flush) {
    await expect(provider.flush()).resolves.toBeUndefined();
  }
  if (provider.reset) {
    await expect(Promise.resolve(provider.reset())).resolves.toBeUndefined();
  }
  if (provider.destroy) {
    await expect(provider.destroy()).resolves.toBeUndefined();
  }
}

async function assertTrackToleratesDifferingAnonymousIds(harness: ProviderContractHarness): Promise<void> {
  const provider = harness.createProvider();
  await expect(
    Promise.resolve(provider.track(harness.makeEvent({ anonymousId: "anon-a" }))),
  ).resolves.toBeUndefined();
  await expect(
    Promise.resolve(provider.track(harness.makeEvent({ anonymousId: "anon-b" }))),
  ).resolves.toBeUndefined();
}

// Exported solely so this kit's own test file (`index.test.ts`) can invoke a
// single contract rule directly, in isolation, and prove it throws/rejects
// against a deliberately broken harness -- not part of the primary public
// API this issue's "Scope" section describes (`ProviderContractHarness`/
// `runProviderContractTests`), just a plain function export used as a
// testing seam (mirrors this repo's existing dependency-injection testing
// seams, e.g. `createPostHogProviderWithClient` in
// `packages/provider-posthog/src/index.ts`). `describe()`/`it()` can't be
// re-registered from inside an already-running test (Bun throws "Cannot
// call describe() inside a test"), so proving each rule fails closed
// against a broken harness is done by calling these directly rather than by
// re-invoking `runProviderContractTests` itself from within a test.
export const contractRuleChecks = {
  capabilitiesShape: assertCapabilitiesShape,
  capabilityImpliesMethodPresence: assertCapabilityImpliesMethodPresence,
  providerNameNonEmpty: assertProviderNameNonEmpty,
  trackResolvesForHealthyTransport: assertTrackResolvesForHealthyTransport,
  trackRejectsForBrokenTransport: assertTrackRejectsForBrokenTransport,
  pageTolerantOfEmptyName: assertPageTolerantOfEmptyName,
  screenTolerantOfEmptyName: assertScreenTolerantOfEmptyName,
  lifecycleMethodsResolveWithoutThrowing: assertLifecycleMethodsResolveWithoutThrowing,
  trackToleratesDifferingAnonymousIds: assertTrackToleratesDifferingAnonymousIds,
} as const;

export function runProviderContractTests(harness: ProviderContractHarness): void {
  describe(`${harness.name} (provider contract)`, () => {
    it("capabilities is a defined object with every required flag present and boolean-typed", () =>
      contractRuleChecks.capabilitiesShape(harness));

    it("a capability flag of true implies the corresponding method exists, and false implies it does not", () =>
      contractRuleChecks.capabilityImpliesMethodPresence(harness));

    it("provider.name is a non-empty string", () => contractRuleChecks.providerNameNonEmpty(harness));

    it("track() resolves for a healthy transport", () => contractRuleChecks.trackResolvesForHealthyTransport(harness));

    it("track() rejects for a broken transport", () => contractRuleChecks.trackRejectsForBrokenTransport(harness));

    it("page() tolerates the empty-string name sentinel without throwing, when implemented", () =>
      contractRuleChecks.pageTolerantOfEmptyName(harness));

    it("screen() tolerates the empty-string name sentinel without throwing, when implemented", () =>
      contractRuleChecks.screenTolerantOfEmptyName(harness));

    it("flush()/reset()/destroy() resolve without throwing, when present", () =>
      contractRuleChecks.lifecycleMethodsResolveWithoutThrowing(harness));

    it("two track() calls with different anonymousId values on the same provider instance both resolve", () =>
      contractRuleChecks.trackToleratesDifferingAnonymousIds(harness));
  });
}
