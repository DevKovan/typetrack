// Built-in `versionMiddleware` (Phase 8 issue 005): an opt-in middleware
// that injects app version/build metadata into every event's
// `event.metadata`. It is a named export, never auto-registered by
// `createAnalytics()` -- an app must explicitly `.use(versionMiddleware({...}))`
// to enable it.
//
// A specialized, narrower case of `enrichmentMiddleware` worth its own named
// export per `plan/VISION.md`'s explicit "version/build metadata injection"
// line item -- and deliberately targets `event.metadata` (not `properties`),
// since app version/build id is infrastructure metadata, not
// application-domain event data.
//
// Static config only: version/build info is typically known once, at
// `createAnalytics()`-construction time, unlike general enrichment which may
// need a per-event function form.
//
// Non-clobbering: merges the configured fields into whatever `event.metadata`
// already contains (set by the app via `TrackOptions.metadata`, or by an
// earlier-registered middleware in the chain) -- existing keys survive
// alongside the injected ones. A collision between a configured field name
// (`appVersion`/`buildId`) and a pre-existing `metadata` key is won by this
// middleware's configured value, mirroring `enrichmentMiddleware`'s
// documented "enrichment overrides" precedence for consistency.
import type { Middleware } from "../middleware";
import type { CanonicalEvent } from "../schema";

export interface VersionOptions {
  appVersion?: string;
  buildId?: string;
}

// Builds the version middleware. Runs in `before()` only -- version
// injection has nothing to observe/react to after dispatch, so no
// `after()`/`onError()` is registered.
export function versionMiddleware(options: VersionOptions): Middleware {
  return {
    name: "version",
    before(event: CanonicalEvent): CanonicalEvent {
      const patch: Record<string, unknown> = {};
      if (options.appVersion !== undefined) patch.appVersion = options.appVersion;
      if (options.buildId !== undefined) patch.buildId = options.buildId;

      return {
        ...event,
        metadata: { ...event.metadata, ...patch },
      };
    },
  };
}
