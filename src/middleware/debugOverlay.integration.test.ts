// Integration tests for Phase 18 issue 004's `debugOverlayMiddleware`: a
// real `createAnalytics({ provider }).use(debugOverlayMiddleware())` round
// trip, exercised against a hand-stubbed `document`/`window`/`navigator`
// (reusing `src/plugins/domInteraction.integration.test.ts`'s
// `Object.defineProperty(globalThis, "document"/"window", ...)` technique,
// extended with a minimal `createElement`/`appendChild`/`removeChild`/`body`
// stub sufficient for this middleware's actual DOM calls).
import { afterEach, describe, expect, it } from "bun:test";
import { createAnalytics } from "../index";
import { debugOverlayMiddleware } from "./debugOverlay";
import type { MinimalElement } from "./debugOverlay";
import type { AnalyticsProvider } from "../providers";
import type { CanonicalEvent } from "../schema";
import { allCapabilities } from "../test-support";

function makeRecordingProvider(): { provider: AnalyticsProvider; trackEvents: CanonicalEvent[] } {
  const trackEvents: CanonicalEvent[] = [];
  const provider: AnalyticsProvider = {
    name: "recording",
    capabilities: allCapabilities,
    track(event) {
      trackEvents.push(event);
    },
    async flush() {},
    async destroy() {},
  };
  return { provider, trackEvents };
}

// A stubbed DOM element sufficient for this middleware's actual calls
// (`style.cssText` assignment, `textContent`, `onclick`, `appendChild`,
// `removeChild`) plus a `children` array so tests can directly assert on
// what got mounted/appended/evicted.
interface StubElement extends MinimalElement {
  tag: string;
  children: StubElement[];
}

function makeStubElement(tag: string): StubElement {
  const el: StubElement = {
    tag,
    children: [],
    appendChild(child: MinimalElement) {
      el.children.push(child as StubElement);
    },
    removeChild(child: MinimalElement) {
      el.children = el.children.filter((c) => c !== (child as StubElement));
    },
  };
  return el;
}

interface StubDocument {
  document: { createElement: (tag: string) => StubElement; body?: StubElement };
  body: StubElement;
  bodyAppendChildCalls: StubElement[];
}

function makeStubDocumentWithBody(): StubDocument {
  const bodyAppendChildCalls: StubElement[] = [];
  const body = makeStubElement("body");
  const originalAppendChild = body.appendChild!;
  body.appendChild = (child: MinimalElement) => {
    bodyAppendChildCalls.push(child as StubElement);
    originalAppendChild(child);
  };

  const document = { createElement: makeStubElement, body };
  return { document, body, bodyAppendChildCalls };
}

function stubBrowserGlobals(document: unknown): void {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: document, configurable: true, writable: true });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "document"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

describe("debugOverlayMiddleware() outside a browser environment", () => {
  it("returns a Middleware whose after() never touches document and never throws", async () => {
    // No `window`/`navigator` stubbed -- `isBrowserEnvironment()` is false.
    // `document` is a Proxy that throws on any property access, so any read
    // at all fails this test loudly.
    const throwingDocument = new Proxy(
      {},
      {
        get() {
          throw new Error("debugOverlayMiddleware must never touch document outside a browser environment");
        },
      },
    );
    Object.defineProperty(globalThis, "document", { value: throwingDocument, configurable: true, writable: true });

    const { provider, trackEvents } = makeRecordingProvider();
    const analytics = createAnalytics({ provider });
    analytics.use(debugOverlayMiddleware());

    await expect(analytics.track("Some Event", { foo: "bar" })).resolves.toBeUndefined();
    expect(trackEvents.length).toBe(1);

    await analytics.destroy();
  });

  it("has no before property", () => {
    const middleware = debugOverlayMiddleware();
    expect("before" in middleware).toBe(false);
    expect(middleware.name).toBe("debug-overlay");
  });
});

describe("debugOverlayMiddleware() inside a stubbed browser environment", () => {
  it("mounts the panel on the first after() call only -- exactly one appendChild onto document.body", async () => {
    const stub = makeStubDocumentWithBody();
    stubBrowserGlobals(stub.document);

    const { provider, trackEvents } = makeRecordingProvider();
    const analytics = createAnalytics({ provider });
    analytics.use(debugOverlayMiddleware());

    await analytics.track("Event One", { a: 1 });
    await analytics.track("Event Two", { a: 2 });
    await analytics.track("Event Three", { a: 3 });

    expect(trackEvents.length).toBe(3);
    expect(stub.bodyAppendChildCalls.length).toBe(1);
    expect(stub.body.children.length).toBe(1);

    await analytics.destroy();
  });

  it("has no before property, and after() resolves without throwing", async () => {
    const stub = makeStubDocumentWithBody();
    stubBrowserGlobals(stub.document);

    const middleware = debugOverlayMiddleware();
    expect("before" in middleware).toBe(false);

    let result: void | Promise<void> | undefined;
    expect(() => {
      result = middleware.after!({
        name: "Test Event",
        properties: {},
        timestamp: Date.now(),
        anonymousId: "anon-1",
        sessionId: "session-1",
      });
    }).not.toThrow();
    await expect(Promise.resolve(result)).resolves.toBeUndefined();
  });

  it("maxEvents eviction caps the retained/rendered row count after exceeding it", async () => {
    const stub = makeStubDocumentWithBody();
    stubBrowserGlobals(stub.document);

    const { provider } = makeRecordingProvider();
    const analytics = createAnalytics({ provider });
    analytics.use(debugOverlayMiddleware({ maxEvents: 3 }));

    for (let i = 0; i < 6; i++) {
      await analytics.track(`Event ${i}`, { i });
    }

    // container -> [toggle, list]
    const container = stub.body.children[0]!;
    const list = container.children[1]!;

    expect(stub.bodyAppendChildCalls.length).toBe(1);
    expect(list.children.length).toBe(3);

    await analytics.destroy();
  });

  it("after() resolves without throwing even when document.body is undefined at call time", async () => {
    const document = { createElement: makeStubElement };
    stubBrowserGlobals(document);

    const { provider, trackEvents } = makeRecordingProvider();
    const analytics = createAnalytics({ provider });
    analytics.use(debugOverlayMiddleware());

    await expect(analytics.track("Early Event", {})).resolves.toBeUndefined();
    expect(trackEvents.length).toBe(1);

    await analytics.destroy();
  });
});
