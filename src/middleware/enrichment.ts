// Built-in `enrichmentMiddleware` (Phase 8 issue 005): an opt-in middleware
// that merges additional properties/context into every event. It is a named
// export, never auto-registered by `createAnalytics()` -- an app must
// explicitly `.use(enrichmentMiddleware({...}))` to enable it.
//
// Precedence (documented, locked): "enrichment overrides" -- when a
// computed enrichment key collides with a key already present on the
// event's `properties`/`context`, the enrichment value wins. This matches
// typical enrichment semantics ("always attach this computed context",
// e.g. app version, environment, feature-flag state) rather than
// fill-in-only-if-absent semantics. Callers who want the opposite
// (event-supplied values winning) should order their enrichment values
// accordingly in their own function form, or avoid colliding keys.
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";

export interface EnrichmentOptions {
  // Either a static object merged into `properties` for every event, or a
  // function computing the merge object per-event (called with the actual
  // event being processed, so the computed values can depend on it).
  properties?: Record<string, unknown> | ((event: CanonicalEvent) => Record<string, unknown>);
  // Same shape as `properties`, but merged into `context` instead.
  context?: Record<string, unknown> | ((event: CanonicalEvent) => Record<string, unknown>);
}

function resolve(
  value: Record<string, unknown> | ((event: CanonicalEvent) => Record<string, unknown>) | undefined,
  event: CanonicalEvent,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return typeof value === "function" ? value(event) : value;
}

// Builds the enrichment middleware. Runs in `before()` only -- enrichment
// has nothing to observe/react to after dispatch, so no `after()`/
// `onError()` is registered.
export function enrichmentMiddleware(options: EnrichmentOptions): Middleware {
  return {
    name: "enrichment",
    before(event: CanonicalEvent): CanonicalEvent {
      const propertiesPatch = resolve(options.properties, event);
      const contextPatch = resolve(options.context, event);

      return {
        ...event,
        // Enrichment overrides: the patch's keys are spread last, so a
        // collision with an existing key is won by the enrichment value.
        properties: propertiesPatch ? { ...event.properties, ...propertiesPatch } : event.properties,
        context: contextPatch ? { ...event.context, ...contextPatch } : event.context,
      };
    },
  };
}
