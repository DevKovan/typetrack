// Unit tests for `loggingMiddleware` (Phase 8 issue 005): isolated logic, no
// I/O -- constructs a `CanonicalEvent` by hand and calls the hooks directly.
import { describe, expect, it, spyOn } from "bun:test";
import { loggingMiddleware } from "./logging";
import type { CanonicalEvent } from "../schema";

function makeEvent(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  return {
    name: "test_event",
    properties: { plan: "pro" },
    timestamp: 0,
    anonymousId: "anon-1",
    sessionId: "session-1",
    ...overrides,
  };
}

describe("loggingMiddleware", () => {
  it("default sink logs to console.log on before() with the event name and properties", () => {
    const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const middleware = loggingMiddleware();
      const event = makeEvent();

      const result = middleware.before!(event);

      expect(result).toBe(event);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const [message, data] = consoleLogSpy.mock.calls[0]!;
      expect(message).toContain("test_event");
      expect(data).toEqual({ plan: "pro" });
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("default sink logs to console.log on after() with a completion marker", () => {
    const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const middleware = loggingMiddleware();
      const event = makeEvent();

      middleware.after!(event);

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const [message] = consoleLogSpy.mock.calls[0]!;
      expect(message).toContain("test_event");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("default sink logs to console.warn on onError() with the error and ctx", () => {
    const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const middleware = loggingMiddleware();
      const event = makeEvent();
      const error = new Error("boom");
      const ctx = { source: "provider" as const, providerName: "stub-provider" };

      middleware.onError!(error, event, ctx);

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const [message, data] = consoleWarnSpy.mock.calls[0]!;
      expect(message).toContain("test_event");
      expect(message).toContain("stub-provider");
      expect(data).toBe(error);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("custom `log` override receives before/after/onError calls instead of console", () => {
    const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const calls: { message: string; data: unknown }[] = [];
      const log = (message: string, data?: unknown) => {
        calls.push({ message, data });
      };
      const middleware = loggingMiddleware({ log });
      const event = makeEvent();
      const error = new Error("boom");

      middleware.before!(event);
      middleware.after!(event);
      middleware.onError!(error, event, { source: "middleware" });

      expect(calls).toHaveLength(3);
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });

  it("before() never transforms/drops the event -- always returns the exact same reference", () => {
    const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const middleware = loggingMiddleware();
      const event = makeEvent();

      const result = middleware.before!(event);

      expect(result).toBe(event);
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("registers before/after/onError", () => {
    const middleware = loggingMiddleware();

    expect(middleware.before).toBeInstanceOf(Function);
    expect(middleware.after).toBeInstanceOf(Function);
    expect(middleware.onError).toBeInstanceOf(Function);
    expect(middleware.name).toBe("logging");
  });
});
