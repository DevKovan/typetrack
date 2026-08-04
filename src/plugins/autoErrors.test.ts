// Unit tests for Phase 10 issue 004's `computeRejectionReason` (pure
// best-effort string coercion, exercised against hand-constructed values --
// no `createAnalytics()`, no providers, no browser globals) and
// `autoErrors()`'s `error`/`unhandledrejection` handling (exercised by
// invoking the plugin's own setup function directly against a stubbed
// `window` and a hand-written fake `Analytics` -- full `createAnalytics()`
// wiring/teardown is exercised by `telemetry.integration.test.ts` instead).
//
// Browser-environment stubbing reuses `src/context.test.ts`'s
// `Object.defineProperty(globalThis, ...)` technique (manual stub, always
// torn down in `afterEach`).
import { afterEach, describe, expect, it, mock } from "bun:test";
import { autoErrors, computeRejectionReason } from "./autoErrors";
import type { Analytics } from "../index";

describe("computeRejectionReason", () => {
  it("returns .message for an Error reason", () => {
    expect(computeRejectionReason(new Error("boom"))).toBe("boom");
  });

  it("returns .message for an Error subclass reason", () => {
    class CustomError extends Error {}
    expect(computeRejectionReason(new CustomError("custom boom"))).toBe("custom boom");
  });

  it("coerces a string reason via String()", () => {
    expect(computeRejectionReason("plain string reason")).toBe("plain string reason");
  });

  it("coerces a number reason via String()", () => {
    expect(computeRejectionReason(404)).toBe("404");
  });

  it("coerces a plain object reason via String()", () => {
    expect(computeRejectionReason({ code: "E_FAIL" })).toBe("[object Object]");
  });

  it("coerces undefined/null reasons via String()", () => {
    expect(computeRejectionReason(undefined)).toBe("undefined");
    expect(computeRejectionReason(null)).toBe("null");
  });

  it("falls back to the placeholder string when String() itself throws", () => {
    const unstringifiable = {
      toString() {
        throw new Error("cannot stringify");
      },
      [Symbol.toPrimitive]() {
        throw new Error("cannot coerce");
      },
    };
    expect(computeRejectionReason(unstringifiable)).toBe("<unstringifiable rejection reason>");
  });
});

type WindowListener = (event: unknown) => void;

interface WindowStub {
  addEventListener: (type: string, listener: WindowListener) => void;
  removeEventListener: (type: string, listener: WindowListener) => void;
}

function stubBrowserGlobals(): WindowStub {
  const windowStub: WindowStub = {
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
  };
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, "addEventListener", {
    value: windowStub.addEventListener,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "removeEventListener", {
    value: windowStub.removeEventListener,
    configurable: true,
    writable: true,
  });
  return windowStub;
}

function clearBrowserGlobals(): void {
  for (const key of ["window", "navigator", "addEventListener", "removeEventListener"] as const) {
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

function getListener(stub: WindowStub, type: string): WindowListener {
  const calls = (stub.addEventListener as ReturnType<typeof mock>).mock.calls;
  const call = calls.find((c) => c[0] === type);
  return call?.[1] as WindowListener;
}

describe("autoErrors()", () => {
  it("registers both 'error' and 'unhandledrejection' listeners on window", () => {
    const windowStub = stubBrowserGlobals();
    const { instance } = makeTrackStub();

    autoErrors()(instance as Analytics<any>);

    expect(windowStub.addEventListener).toHaveBeenCalledTimes(2);
    expect((windowStub.addEventListener as ReturnType<typeof mock>).mock.calls.map((c) => c[0]).sort()).toEqual([
      "error",
      "unhandledrejection",
    ]);
  });

  it("tracks 'Error Occurred' with message/filename/lineno/colno/stack off the ErrorEvent", () => {
    const windowStub = stubBrowserGlobals();
    const { track, instance } = makeTrackStub();

    autoErrors()(instance as Analytics<any>);
    const listener = getListener(windowStub, "error");

    listener({
      message: "Uncaught TypeError: x is not a function",
      filename: "app.js",
      lineno: 42,
      colno: 7,
      error: { stack: "TypeError: x is not a function\n  at app.js:42:7" },
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Error Occurred", {
      message: "Uncaught TypeError: x is not a function",
      filename: "app.js",
      lineno: 42,
      colno: 7,
      stack: "TypeError: x is not a function\n  at app.js:42:7",
    });
  });

  it("omits stack when event.error is absent", () => {
    const windowStub = stubBrowserGlobals();
    const { track, instance } = makeTrackStub();

    autoErrors()(instance as Analytics<any>);
    const listener = getListener(windowStub, "error");

    listener({ message: "err", filename: "app.js", lineno: 1, colno: 1 });

    expect(track).toHaveBeenCalledTimes(1);
    const properties = track.mock.calls[0]?.[1] as Record<string, unknown>;
    expect("stack" in properties).toBe(false);
  });

  it("tracks 'Unhandled Rejection' with reason = Error.message for an Error reason", () => {
    const windowStub = stubBrowserGlobals();
    const { track, instance } = makeTrackStub();

    autoErrors()(instance as Analytics<any>);
    const listener = getListener(windowStub, "unhandledrejection");

    listener({ reason: new Error("network failed") });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Unhandled Rejection", { reason: "network failed" });
  });

  it("tracks 'Unhandled Rejection' with a String()-coerced reason for a non-Error reason", () => {
    const windowStub = stubBrowserGlobals();
    const { track, instance } = makeTrackStub();

    autoErrors()(instance as Analytics<any>);
    const listener = getListener(windowStub, "unhandledrejection");

    listener({ reason: "server returned 500" });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("Unhandled Rejection", { reason: "server returned 500" });
  });

  it("teardown removes both listeners via window.removeEventListener", () => {
    const windowStub = stubBrowserGlobals();
    const { instance } = makeTrackStub();

    const teardown = autoErrors()(instance as Analytics<any>);
    const errorListener = getListener(windowStub, "error");
    const rejectionListener = getListener(windowStub, "unhandledrejection");

    teardown?.();

    expect(windowStub.removeEventListener).toHaveBeenCalledWith("error", errorListener);
    expect(windowStub.removeEventListener).toHaveBeenCalledWith("unhandledrejection", rejectionListener);
  });

  it("returns undefined and attaches no listener outside a browser environment", () => {
    const { track, instance } = makeTrackStub();

    const teardown = autoErrors()(instance as Analytics<any>);

    expect(teardown).toBeUndefined();
    expect(track).not.toHaveBeenCalled();
  });

  it("never throws even without window/navigator present", () => {
    const { instance } = makeTrackStub();
    expect(() => autoErrors()(instance as Analytics<any>)).not.toThrow();
  });
});
