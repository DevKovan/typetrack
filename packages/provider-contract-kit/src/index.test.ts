import { describe, expect, it } from "bun:test";
import type { AnalyticsProvider, CanonicalEvent } from "typetrack";
import { contractRuleChecks, runProviderContractTests, type ProviderContractHarness } from "./index";

// Unit tests -- no real network I/O, no `mock.module()`. Proves the kit's
// own assertions actually catch violations, using hand-written fake
// `AnalyticsProvider`s (no real adapter involved), per this issue's
// "Testing" section
// (plan/phase-16-testing-infrastructure/001-provider-contract-kit.md).

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "Test Event",
    properties: {},
    timestamp: 1_700_000_000_000,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

// A fully compliant fake, satisfying every rule `runProviderContractTests`
// checks: every required capability flag is boolean, every `true` flag has
// a matching method (and every `false` flag has none), `track()` resolves
// against `createProvider()`'s transport and rejects against
// `createFailingProvider()`'s, `page()`/`screen()` tolerate an empty-string
// name, and `flush()`/`reset()`/`destroy()` all resolve without throwing.
function makeCompliantProvider(options: { failing?: boolean } = {}): AnalyticsProvider {
  return {
    name: "compliant-fake",
    capabilities: {
      identify: true,
      group: false,
      alias: false,
      page: true,
      screen: true,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
      batch: false,
      runtimes: ["node", "browser"],
    },
    async track() {
      if (options.failing) {
        throw new Error("simulated transport failure");
      }
    },
    identify() {},
    async page() {},
    async screen() {},
    async flush() {},
    reset() {},
    async destroy() {},
  };
}

const compliantHarness: ProviderContractHarness = {
  name: "Compliant fake",
  createProvider: () => makeCompliantProvider(),
  createFailingProvider: () => makeCompliantProvider({ failing: true }),
  makeEvent,
};

// Registers real describe()/it() blocks at module scope (not nested inside
// another test -- Bun disallows calling describe() while a test is already
// running). Every assertion inside must pass for `bun test` to report this
// file green, which is itself the proof that the kit does not false-positive
// against a genuinely compliant fake.
runProviderContractTests(compliantHarness);

describe("contractRuleChecks (targeted rule-violation coverage)", () => {
  it("capabilitiesShape rejects a non-boolean required flag", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        // Deliberately wrong shape for this test.
        capabilities: { ...makeCompliantProvider().capabilities, identify: "yes" as unknown as boolean },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.capabilitiesShape(harness)).rejects.toThrow();
  });

  it("capabilitiesShape rejects a non-array runtimes value", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        capabilities: { ...makeCompliantProvider().capabilities, runtimes: "node" as unknown as Array<"node"> },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.capabilitiesShape(harness)).rejects.toThrow();
  });

  it("capabilityImpliesMethodPresence rejects capabilities.identify: true with no identify() method", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => {
        const provider = makeCompliantProvider();
        delete provider.identify;
        return { ...provider, capabilities: { ...provider.capabilities, identify: true } };
      },
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.capabilityImpliesMethodPresence(harness)).rejects.toThrow();
  });

  it("capabilityImpliesMethodPresence rejects capabilities.group: false with a group() method still present", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        capabilities: { ...makeCompliantProvider().capabilities, group: false },
        group() {},
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.capabilityImpliesMethodPresence(harness)).rejects.toThrow();
  });

  it("providerNameNonEmpty rejects an empty-string provider.name", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({ ...makeCompliantProvider(), name: "" }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.providerNameNonEmpty(harness)).rejects.toThrow();
  });

  it("trackResolvesForHealthyTransport rejects when createProvider()'s track() actually throws", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => makeCompliantProvider({ failing: true }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.trackResolvesForHealthyTransport(harness)).rejects.toThrow();
  });

  it("trackRejectsForBrokenTransport rejects when createFailingProvider()'s track() actually succeeds", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => makeCompliantProvider(),
      // Deliberately wired to succeed, violating the harness contract.
      createFailingProvider: () => makeCompliantProvider({ failing: false }),
      makeEvent,
    };

    await expect(contractRuleChecks.trackRejectsForBrokenTransport(harness)).rejects.toThrow();
  });

  it("pageTolerantOfEmptyName rejects when page() throws on an empty-string name despite capabilities.page: true", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        async page(event: CanonicalEvent) {
          if (event.name === "") throw new Error("does not tolerate empty name");
        },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.pageTolerantOfEmptyName(harness)).rejects.toThrow();
  });

  it("screenTolerantOfEmptyName rejects when screen() throws on an empty-string name despite capabilities.screen: true", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        async screen(event: CanonicalEvent) {
          if (event.name === "") throw new Error("does not tolerate empty name");
        },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.screenTolerantOfEmptyName(harness)).rejects.toThrow();
  });

  it("lifecycleMethodsResolveWithoutThrowing rejects when flush() throws", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        async flush() {
          throw new Error("flush is broken");
        },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.lifecycleMethodsResolveWithoutThrowing(harness)).rejects.toThrow();
  });

  it("lifecycleMethodsResolveWithoutThrowing rejects when destroy() throws", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        async destroy() {
          throw new Error("destroy is broken");
        },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.lifecycleMethodsResolveWithoutThrowing(harness)).rejects.toThrow();
  });

  it("lifecycleMethodsResolveWithoutThrowing rejects when reset() throws", async () => {
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        reset() {
          throw new Error("reset is broken");
        },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.lifecycleMethodsResolveWithoutThrowing(harness)).rejects.toThrow();
  });

  it("trackToleratesDifferingAnonymousIds rejects when a second track() call with a different anonymousId throws", async () => {
    let callCount = 0;
    const harness: ProviderContractHarness = {
      name: "broken",
      createProvider: () => ({
        ...makeCompliantProvider(),
        async track() {
          callCount += 1;
          if (callCount === 2) throw new Error("cannot handle a second anonymousId");
        },
      }),
      createFailingProvider: () => makeCompliantProvider({ failing: true }),
      makeEvent,
    };

    await expect(contractRuleChecks.trackToleratesDifferingAnonymousIds(harness)).rejects.toThrow();
  });
});
