// Unit tests for Phase 10 issue 003's `autoVisibility()` (exercised by
// invoking the plugin's own setup function directly against a stubbed
// `document` and a hand-written fake `Analytics` -- no `createAnalytics()`,
// no providers). Full setup/dispatch/teardown wiring through a real
// `createAnalytics({ plugins: [...] })` is exercised by
// `domInteraction.integration.test.ts` instead.
//
// Browser-environment stubbing reuses `src/context.test.ts`'s
// `Object.defineProperty(globalThis, ...)` technique (manual stub, always
// torn down in `afterEach`).
import { afterEach, describe, expect, it, mock } from "bun:test";
import { autoVisibility } from "./autoVisibility";
import type { Analytics } from "../index";

type VisibilityListener = () => void;

interface DocumentStub {
  visibilityState: string;
  addEventListener: (type: string, listener: VisibilityListener) => void;
  removeEventListener: (type: string, listener: VisibilityListener) => void;
}

function stubBrowserGlobals(documentStub: DocumentStub): void {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true, writable: true });
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "document"] as const) {
    delete (globalThis as Record<string, unknown>)[key];
  }
}

afterEach(() => {
  clearBrowserGlobals();
});

function makeTrackStub(): { track: ReturnType<typeof mock>; instance: Pick<Analytics<any>, "track"> } {
  const track = mock(() => {});
  return { track, instance: { track } };
}

describe("autoVisibility()", () => {
  it("fires track('Page Visibility Changed', { state }) with the current document.visibilityState on a visibilitychange event", () => {
    const documentStub: DocumentStub = {
      visibilityState: "hidden",
      addEventListener: mock(() => {}),
      removeEventListener: mock(() => {}),
    };
    stubBrowserGlobals(documentStub);
    const { track, instance } = makeTrackStub();

    const teardown = autoVisibility()(instance as Analytics<any>);
    const listener = (documentStub.addEventListener as ReturnType<typeof mock>).mock.calls[0]?.[1] as VisibilityListener;

    listener();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Page Visibility Changed", { state: "hidden" });

    teardown?.();
  });

  it("reads document.visibilityState fresh on each firing (not cached at setup time)", () => {
    const documentStub: DocumentStub = {
      visibilityState: "visible",
      addEventListener: mock(() => {}),
      removeEventListener: mock(() => {}),
    };
    stubBrowserGlobals(documentStub);
    const { track, instance } = makeTrackStub();

    const teardown = autoVisibility()(instance as Analytics<any>);
    const listener = (documentStub.addEventListener as ReturnType<typeof mock>).mock.calls[0]?.[1] as VisibilityListener;

    listener();
    documentStub.visibilityState = "hidden";
    listener();

    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenNthCalledWith(1, "Page Visibility Changed", { state: "visible" });
    expect(track).toHaveBeenNthCalledWith(2, "Page Visibility Changed", { state: "hidden" });

    teardown?.();
  });

  it("registers the listener via document.addEventListener('visibilitychange', ...)", () => {
    const documentStub: DocumentStub = {
      visibilityState: "visible",
      addEventListener: mock(() => {}),
      removeEventListener: mock(() => {}),
    };
    stubBrowserGlobals(documentStub);
    const { instance } = makeTrackStub();

    autoVisibility()(instance as Analytics<any>);

    expect(documentStub.addEventListener).toHaveBeenCalledTimes(1);
    expect((documentStub.addEventListener as ReturnType<typeof mock>).mock.calls[0]?.[0]).toBe("visibilitychange");
  });

  it("teardown removes the visibilitychange listener via document.removeEventListener", () => {
    const documentStub: DocumentStub = {
      visibilityState: "visible",
      addEventListener: mock(() => {}),
      removeEventListener: mock(() => {}),
    };
    stubBrowserGlobals(documentStub);
    const { instance } = makeTrackStub();

    const teardown = autoVisibility()(instance as Analytics<any>);
    const listener = (documentStub.addEventListener as ReturnType<typeof mock>).mock.calls[0]?.[1] as VisibilityListener;

    teardown?.();

    expect(documentStub.removeEventListener).toHaveBeenCalledWith("visibilitychange", listener);
  });

  it("returns undefined and attaches no listener outside a browser environment", () => {
    const { track, instance } = makeTrackStub();

    const teardown = autoVisibility()(instance as Analytics<any>);

    expect(teardown).toBeUndefined();
    expect(track).not.toHaveBeenCalled();
  });

  it("never throws even without window/navigator/document present", () => {
    const { instance } = makeTrackStub();
    expect(() => autoVisibility()(instance as Analytics<any>)).not.toThrow();
  });
});
