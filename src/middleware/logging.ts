// Built-in `loggingMiddleware` (Phase 8 issue 005): an opt-in observability
// middleware that logs `before`/`after`/`onError` activity for every event
// passing through the chain. It is a named export, never auto-registered by
// `createAnalytics()` -- an app must explicitly `.use(loggingMiddleware())`
// to enable it.
//
// This is the middleware that exercises all three `Middleware` hook types
// (`before`, `after`, `onError`) -- deliberately, so it's a good reference
// implementation for `examples/middleware/` (issue 006) to point at for
// "here's what a full-coverage middleware looks like".
//
// Pure observer: `before()` always returns the event unchanged (never
// transforms, never drops). Logging is a side effect only.
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";

export interface LoggingOptions {
  // Sink used for every log call this middleware makes. Defaults to
  // `console.log` for `before`/`after` and `console.warn` for `onError`.
  // Supplying `log` overrides both -- every call (including the `onError`
  // path) goes through the single supplied function instead, so an app can
  // redirect all of this middleware's output to its own logger.
  log?: (message: string, data?: unknown) => void;
}

function defaultLog(message: string, data?: unknown): void {
  console.log(message, data);
}

function defaultWarnLog(message: string, data?: unknown): void {
  console.warn(message, data);
}

// Builds the logging middleware. Registers `before`, `after`, and `onError`
// -- see the module doc comment above for why all three are wired up here.
export function loggingMiddleware(options?: LoggingOptions): Middleware {
  const log = options?.log ?? defaultLog;
  // When a custom `log` is supplied, it's used for every call site
  // (including what would otherwise be a `console.warn`) -- there's only
  // one override slot, not a separate warn override, since `LoggingOptions`
  // exposes a single `log` field per the issue's locked shape.
  const warnLog = options?.log ?? defaultWarnLog;

  return {
    name: "logging",
    before(event: CanonicalEvent): CanonicalEvent {
      log(`typetrack: [before] "${event.name}"`, event.properties);
      return event;
    },
    after(event: CanonicalEvent): void {
      log(`typetrack: [after] "${event.name}" dispatched`);
    },
    onError(error: unknown, event: CanonicalEvent, ctx: { source: "middleware" | "provider"; providerName?: string }): void {
      warnLog(`typetrack: [error] "${event.name}" (source: ${ctx.source}${ctx.providerName ? `, provider: ${ctx.providerName}` : ""})`, error);
    },
  };
}
