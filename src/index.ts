import { captureDynamicContext, captureStaticContext, isBrowserEnvironment } from "./context";
import type { ContextOptions } from "./context";
import { hasConsent, isConsentedForCategories, isConsentedForProvider, resolveDefaultState } from "./consent";
import type { ConsentCategory, ConsentOptions, ConsentState } from "./consent";
import { runAfterChain, runBeforeChain, type Middleware } from "./middleware";
import type { Plugin } from "./plugins";
import { noopProvider, type AnalyticsProvider, type ProviderCapabilities } from "./providers";
import { normalizeProviders, shouldRouteToProvider, sortByPriority } from "./routing";
import type { ProviderEntry } from "./routing";
import { createQueueEngine } from "./reliability/queue";
import type { BackoffOptions, QueueEngine } from "./reliability/queue";
import { chunkForBatching } from "./reliability/batch";
import {
  createIndexedDbStorageAdapter,
  createLocalStorageAdapter,
  createMemoryStorageAdapter,
  detectBestStorage,
} from "./reliability/storage";
import type { PersistedQueueEntry, QueueStorageAdapter } from "./reliability/storage";
import { EventValidationError } from "./schema";
import type { CanonicalEvent, EventMap, SchemaMap, TrackArgs, TrackOptions } from "./schema";

export type { Middleware } from "./middleware";
export { redactMiddleware } from "./middleware/redact";
export type { RedactOptions } from "./middleware/redact";
export { piiFilterMiddleware } from "./middleware/piiFilter";
export type { PiiFilterOptions } from "./middleware/piiFilter";
export { samplingMiddleware } from "./middleware/sampling";
export type { SamplingOptions } from "./middleware/sampling";
export { loggingMiddleware } from "./middleware/logging";
export type { LoggingOptions } from "./middleware/logging";
export { enrichmentMiddleware } from "./middleware/enrichment";
export type { EnrichmentOptions } from "./middleware/enrichment";
export { versionMiddleware } from "./middleware/version";
export type { VersionOptions } from "./middleware/version";
export { timingMiddleware } from "./middleware/timing";
export type { TimingOptions } from "./middleware/timing";
export { noopProvider } from "./providers";
export type { AnalyticsProvider, ProviderCapabilities } from "./providers";
export type { ProviderEntry, RouteMatcher } from "./routing";
export type { CanonicalEvent, EventMap, InferEvents, SchemaMap, TrackOptions } from "./schema";
export { EventValidationError } from "./schema";
export type { ConsentCategory, ConsentDecision, ConsentOptions, ConsentState } from "./consent";
export type { CapturedContext, ContextOptions } from "./context";
export { isBrowserEnvironment } from "./context";
export type { Plugin } from "./plugins";
export { autoPage, dispatchPageView } from "./plugins/autoPage";
export type { PageViewArgs, AutoPageOptions } from "./plugins/autoPage";
export { autoClicks } from "./plugins/autoClicks";
export type { AutoClicksOptions } from "./plugins/autoClicks";
export { autoScroll } from "./plugins/autoScroll";
export type { AutoScrollOptions } from "./plugins/autoScroll";
export { autoVisibility } from "./plugins/autoVisibility";
export { autoErrors } from "./plugins/autoErrors";
export { autoWebVitals } from "./plugins/autoWebVitals";
export type { WebVitalName, WebVitalRating } from "./plugins/autoWebVitals";
export { autoPerformance } from "./plugins/autoPerformance";
export type { PagePerformanceProperties } from "./plugins/autoPerformance";
export { autoUTM } from "./plugins/autoUTM";
export type { AutoUTMOptions } from "./plugins/autoUTM";
export type { BackoffOptions } from "./reliability/queue";

export interface CreateAnalyticsOptions<Events extends EventMap = EventMap> {
  // A single bare provider keeps exact Phase 6 passthrough behavior (no
  // routing evaluation, no `Promise.allSettled` fan-out wrapping). Wrapping
  // it in a `ProviderEntry`, or supplying an array (of any length, including
  // 0 or 1), opts into the multi-provider fan-out path -- see
  // `src/routing.ts`'s `normalizeProviders`/`NormalizedProviders.isMulti`.
  provider?: AnalyticsProvider | ProviderEntry | (AnalyticsProvider | ProviderEntry)[];
  // Optional per-event Zod schemas. An event without an entry here is
  // forwarded unvalidated, exactly as in issue 001. See `SchemaMap`.
  schemas?: SchemaMap<Events>;
  // Optional opt-out from the issue-002 default (`track()` throwing a
  // synchronous `EventValidationError` on a failed validation). When
  // supplied, a failed validation instead calls this handler with the
  // `EventValidationError` and `track()` returns normally without calling
  // the provider. If the handler itself throws, that exception propagates
  // out of `track()` as-is -- it is not swallowed.
  onValidationError?: (error: EventValidationError) => void;
  // Opt-in dev-mode mirroring of every `track()` call to a locally running
  // `startDevServer()` (see `src/devServer/`). `true` posts to the dev
  // server's own default (`http://127.0.0.1:4318/events`); `{ url }` posts
  // to an exact URL instead, for when the app developer has read the real
  // running port (e.g. from `.typetrack/port`) themselves. Core never
  // inspects `NODE_ENV`/`import.meta.env` or reads any file on its own to
  // decide this -- gating "am I in dev" is entirely the caller's
  // responsibility. See issue 006 for the full rationale.
  devServer?: boolean | { url?: string };
  // Opt-in automatic environment/session context capture, merged onto
  // `CanonicalEvent.context` for `track`/`page`/`screen` only (`identify`/
  // `group`/`alias`/`reset`/`flush`/`destroy` have no `CanonicalEvent` and
  // are unaffected). `true` is shorthand for `{ autoCapture: true }`.
  // Omitted (the default), `false`, or `{ autoCapture: false }` are all
  // equivalent to "off" -- zero behavior change from pre-Phase-9:
  // `CanonicalEvent.context` remains exactly `verbOptions?.context`
  // (`undefined` when not supplied), with no `Intl`/UA work performed at
  // all. See `src/context.ts` for the captured shape
  // (`CapturedContext`/`ContextOptions`).
  context?: boolean | ContextOptions;
  // Plugins to auto-invoke once, in array order, at construction time --
  // distinct from `.use()` (Phase 8 middleware, which transforms/observes
  // events already in flight; plugins instead originate new track calls of
  // their own). Each plugin is called with the fully-constructed `Analytics`
  // instance; its optional returned teardown function (if any) is invoked by
  // `destroy()`, before the existing provider flush+destroy logic. See
  // `src/plugins.ts` for the full `Plugin` contract.
  plugins?: Plugin[];
  // Phase 11 issue 002: opt-in consent gating for the six data-carrying
  // verbs (`track`/`page`/`screen`/`identify`/`group`/`alias`). Omitted
  // entirely (the default) is zero behavior change from pre-Phase-11: no
  // gating is performed on any verb (there's no `requiredCategories` to
  // check against), though `analytics.consent`'s `grant()`/`deny()`/`get()`
  // still work and track state regardless -- they simply have no gating
  // effect on their own without `requiredCategories` configured here. See
  // `src/consent.ts` for the full `ConsentOptions` shape.
  consent?: ConsentOptions;
  // Phase 11 issue 004: opt-in, construction-time-only policy that makes
  // `identify()`/`alias()` complete no-ops (beyond a one-time `console.warn`
  // -- see below) for this instance's entire lifetime. `userId` is never
  // set, even if `identify()` is called. `group()` is deliberately
  // *unaffected* by this option -- a group (organization/team/account) is
  // not itself a personal identifier the way `userId` is, so suppressing it
  // too would be over-broad; an app that also wants to suppress `group()`
  // must gate that call itself. Defaults to `false` (omitted is zero
  // behavior change from pre-issue-004). There is no runtime toggle for
  // this option -- apps that need to switch between anonymous and
  // identified tracking at runtime should construct a new `Analytics`
  // instance instead (see `plan/phase-11-privacy-consent/004-anonymous-mode.md`).
  anonymousMode?: boolean;
  // Phase 11 issue 006: opt-in, construction-time-only declaration that this
  // instance never persists any client-side identifier (no
  // localStorage/sessionStorage/cookie writes). Core itself already never
  // does this regardless of this flag -- `anonymousId`/`sessionId` are
  // in-memory-only since Phase 6 -- so this option's only *behavioral*
  // effect today is on plugins that read `analytics.cookieless` themselves
  // (starting with `autoUTM`, which skips its own `sessionStorage`
  // first-touch-campaign persistence when this is `true`). Defaults to
  // `false` (omitted is zero behavior change). See
  // `plan/phase-11-privacy-consent/006-cookieless-mode-and-autoutm.md`.
  cookieless?: boolean;
  // Phase 12 issue 003: opt-in offline queue/retry/dead-letter for
  // `track`/`page`/`screen` (only -- `identify`/`group`/`alias` keep
  // pre-Phase-12 fire-and-forget behavior, per
  // `plan/phase-12-reliability/BRIEF.md`'s scope boundary). Omitted entirely
  // (the default) is zero behavior change from pre-Phase-12: a failed
  // provider call is still `console.warn`ed + immediately `onError`-notified
  // + swallowed, with no queue, no persistence, no retry, and no offline
  // detection anywhere. `true` is shorthand for every `ReliabilityOptions`
  // field taking its documented default. See
  // `plan/phase-12-reliability/003-reliability-wiring.md`.
  reliability?: boolean | ReliabilityOptions;
}

// Phase 12 issue 003: the object form of `CreateAnalyticsOptions.reliability`
// -- mirrors `devServer?: boolean | { url? }`'s shorthand-or-object shape
// exactly. `batch`/`flushOnUnload` are defined here (this issue's own type
// shape) but deliberately unconsumed by this issue -- issue 005 wires
// `batch` into the drain loop, issue 006 wires `flushOnUnload` into a
// `sendBeacon`-based unload flush. `true` (the boolean shorthand) is
// equivalent to `{}` here: every field below is resolved against its own
// documented default by whatever consumes it (`detectBestStorage`,
// `createQueueEngine`), so no field-by-field defaulting happens in this
// type/its resolver -- see `resolveReliabilityOptions()`.
export interface ReliabilityOptions {
  // `"auto"` (the default) probes IndexedDB -> localStorage -> memory via
  // `detectBestStorage` (`src/reliability/storage.ts`). An explicit value
  // selects that backend's adapter factory directly, skipping the probe.
  storage?: "auto" | "indexeddb" | "localstorage" | "memory";
  // Bounded queue size (issue 002's `maxQueueSize`, default 100) -- see
  // BRIEF.md decision 6 (drop-oldest-lowest-priority on overflow).
  maxQueueSize?: number;
  // Retry attempts before an entry is dead-lettered (issue 002's
  // `maxAttempts`, default 5) -- see BRIEF.md decision 5.
  maxAttempts?: number;
  // Exponential backoff schedule (issue 002's `BackoffOptions`) -- see
  // `computeBackoffDelay()` in `src/reliability/queue.ts` for its defaults.
  backoff?: BackoffOptions;
  // Phase 12 issue 005: governs `drainQueueOnce()`'s `trackBatch`
  // coalescing for batch-capable providers (`ProviderCapabilities.batch`,
  // `AnalyticsProvider.trackBatch`) -- see that function's doc comment for
  // the full algorithm. `size` (default 10) is the max number of events per
  // `trackBatch` call; `intervalMs` (default 5000) is the max time a
  // partial (< `size`) group's oldest ready entry is allowed to wait before
  // being sent anyway, approximated per-tick rather than via a genuine
  // second accumulation timer (see `src/reliability/batch.ts`'s doc
  // comment). Has no effect on a provider that doesn't declare
  // `capabilities.batch`/implement `trackBatch` -- that provider is always
  // drained one entry at a time, exactly as issue 003 specified.
  batch?: { size?: number; intervalMs?: number };
  // Defined by this issue's type shape but not yet consumed anywhere --
  // issue 006 wires a `sendBeacon`-based flush into an unload listener.
  // Documented default (`true`) under `reliability: true`, though nothing
  // reads it yet.
  flushOnUnload?: boolean;
}

// The `analytics.queue` runtime surface -- always present on `Analytics`
// (BRIEF.md decision 7), independent of whether the `reliability`
// construction option was ever supplied. `size()` is always `0` and
// `drain()`/`clear()` are complete no-ops when `reliability` was never
// enabled -- there is never anything to queue in that case, so the surface
// stays uniform rather than `consent`-style-optional.
export interface QueueController {
  size(): number;
  drain(): Promise<void>;
  clear(): void;
}

// The `analytics.consent` runtime surface -- always present on `Analytics`,
// independent of whether the `consent` construction option was supplied. An
// app can call `analytics.consent.grant("analytics")` even if it never
// configured `requiredCategories` -- the grant is recorded (visible via
// `.get()`/`.hasConsent()`) but has no gating effect on its own; issue 005's
// per-provider `requiresConsent` can still reference it.
export interface ConsentController {
  // Zero-argument calls are a no-op.
  grant(...categories: ConsentCategory[]): void;
  deny(...categories: ConsentCategory[]): void;
  hasConsent(category: ConsentCategory): boolean;
  // Returns a shallow-cloned snapshot (`{ ...consentState }`), not a live
  // reference -- mutating the returned object never affects internal state.
  get(): ConsentState;
}

const DEFAULT_DEV_SERVER_URL = "http://127.0.0.1:4318/events";

function resolveDevServerUrl(
  devServer: CreateAnalyticsOptions["devServer"],
): string | undefined {
  if (!devServer) return undefined;
  if (devServer === true) return DEFAULT_DEV_SERVER_URL;
  return devServer.url ?? DEFAULT_DEV_SERVER_URL;
}

// Mirrors `resolveDevServerUrl`'s normalization pattern. Returns `undefined`
// for any falsy input (including `{ autoCapture: false }`) so the rest of
// `createAnalytics()` has a single "off" signal to check (`staticContext ===
// undefined`) rather than re-deriving this in multiple places.
function resolveContextOptions(
  context: CreateAnalyticsOptions["context"],
): ContextOptions | undefined {
  if (!context) return undefined;
  if (context === true) return { autoCapture: true };
  return context.autoCapture ? context : undefined;
}

// Mirrors `resolveDevServerUrl`/`resolveContextOptions`'s normalization
// pattern exactly. `undefined` is the single "reliability is off" signal the
// rest of `createAnalytics()` checks (via `queueEngine`'s own presence,
// below) -- `true` resolves to `{}` since every individual field is given
// its documented default by whichever consumer reads it (`detectBestStorage`
// for `storage`, `createQueueEngine` for `maxQueueSize`/`maxAttempts`/
// `backoff`), not by this resolver itself.
function resolveReliabilityOptions(
  reliability: CreateAnalyticsOptions["reliability"],
): ReliabilityOptions | undefined {
  if (!reliability) return undefined;
  if (reliability === true) return {};
  return reliability;
}

// The five verbs whose behavior depends on whether the resolved provider
// actually implements them: an app can call `identify()`/`page()`/`group()`/
// `alias()`/`screen()` against any provider regardless of what that
// provider's adapter actually wired up -- providers that don't support a
// given verb (declared via `capabilities`, or simply missing the optional
// method) get a one-time `console.warn` instead of a thrown exception or a
// silent-but-wrong call into `undefined`.
type GatedCapability = "identify" | "page" | "group" | "alias" | "screen";

export interface Analytics<Events extends EventMap = EventMap> {
  track<K extends keyof Events>(event: K, ...args: TrackArgs<Events[K]>): void | Promise<void>;
  identify(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
  page(name?: string, props?: Record<string, unknown>, options?: TrackOptions): void | Promise<void>;
  group(groupId: string, traits?: Record<string, unknown>): void | Promise<void>;
  alias(newUserId: string, previousUserId?: string): void | Promise<void>;
  screen(name?: string, props?: Record<string, unknown>, options?: TrackOptions): void | Promise<void>;
  reset(): void | Promise<void>;
  flush(): Promise<void>;
  destroy(): Promise<void>;
  // Registers a middleware onto this instance's chain. Accumulates in
  // registration order -- no dedup by `Middleware.name`. Purely additive as
  // of this issue: registered middlewares are not yet consumed by
  // `track`/`page`/`screen` (issue 002 wires that in).
  use(middleware: Middleware): void;
  // Phase 11 issue 002: the consent runtime surface, always present
  // (non-optional) regardless of whether the `consent` construction option
  // was supplied. Gates `track`/`page`/`screen`/`identify`/`group`/`alias`
  // globally when `requiredCategories` is configured -- see
  // `ConsentController` and `isTrackingAllowed()` below.
  consent: ConsentController;
  // Phase 11 issue 003: the coarse operational kill switch, independent of
  // (and evaluated with AND semantics against) `consent` above. Defaults to
  // enabled (`isEnabled()` is `true` immediately after construction, with no
  // other calls) -- zero behavior change from pre-issue-003 for apps that
  // never call `enable()`/`disable()`. See `isTrackingAllowed()` below for
  // how this composes with the consent gate.
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  // Phase 11 issue 006: mirrors `CreateAnalyticsOptions.cookieless` exactly
  // (`analytics.cookieless === (options.cookieless ?? false)`) -- a plain
  // readonly property, not a method, since it never changes after
  // construction (no runtime toggle exists, matching `anonymousMode`
  // above). Plugins (e.g. `autoUTM`) read this off the live `Analytics`
  // instance they're already handed at setup time to decide whether to
  // skip their own storage writes.
  readonly cookieless: boolean;
  // Phase 12 issue 003: always present (non-optional), regardless of
  // whether `reliability` was supplied at construction -- mirrors
  // `consent` above's always-present precedent (BRIEF.md decision 7). See
  // `QueueController`'s doc comment for the no-op behavior when
  // `reliability` was never enabled.
  queue: QueueController;
}

export function createAnalytics<Events extends EventMap = EventMap>(
  options: CreateAnalyticsOptions<Events> = {},
): Analytics<Events> {
  // `normalizeProviders` doesn't own the `noopProvider` default (issue 001's
  // contract) -- it's applied here, before normalization, exactly once at
  // construction. Construction-time `include`+`exclude` conflicts throw
  // synchronously out of `normalizeProviders`, and therefore out of
  // `createAnalytics()` itself.
  const normalized = normalizeProviders(options.provider ?? noopProvider);
  const schemas = options.schemas;
  const onValidationError = options.onValidationError;
  const devServerUrl = resolveDevServerUrl(options.devServer);

  // `undefined` here is this issue's single "auto-capture is off" signal --
  // every call site below gates on `contextOptions`/`staticContext` being
  // truthy before doing any work.
  const contextOptions = resolveContextOptions(options.context);
  // Captured exactly once, at construction time, only when auto-capture is
  // on -- never re-invoked per call (that's `captureDynamicContext`'s job,
  // below). Left `undefined` (not even attempted) when auto-capture is off,
  // per this issue's hot-path/back-compat requirement: no `Intl`/UA work at
  // all for apps that never opted in.
  const staticContext = contextOptions ? captureStaticContext() : undefined;

  // Identity/session state now lives in core, generated once at
  // construction, in-memory only -- no persistence across process restarts.
  // Adapters no longer generate or own any of this. One set of identity
  // fields is shared across every provider in the list (not per-provider).
  let anonymousId = crypto.randomUUID();
  let sessionId = crypto.randomUUID();
  let userId: string | undefined;

  // Session bookkeeping (`context.session`, additive to `sessionId` --
  // Phase 9). Cheap to initialize unconditionally (`Date.now()`/`0`), but
  // only ever read/merged into an event's `context` when auto-capture is on.
  let sessionStartedAt = Date.now();
  let sessionEventCount = 0;

  // Backs the one-warning-per-`${provider.name}:${capability}` policy below.
  // A single `Set<string>` closure variable naturally provides "per-provider"
  // dedup already, since the key includes `provider.name`.
  const warnedCapabilities = new Set<string>();

  // Phase 11 issue 004: immutable for the instance's lifetime -- captured
  // once here, never reassigned (no runtime toggle method exists on
  // `Analytics`). Backs the `identify()`/`alias()` no-op gate below.
  const anonymousMode = options.anonymousMode ?? false;
  // Separate key space from `warnedCapabilities` above (different reason: an
  // instance-level policy choice, not a per-provider capability gap) -- one
  // warning per verb (`identify`/`alias`), ever, for this instance.
  const warnedAnonymousMode = new Set<"identify" | "alias">();

  // Phase 11 issue 006: immutable for the instance's lifetime -- captured
  // once here, never reassigned (no runtime toggle method exists on
  // `Analytics`, matching `anonymousMode` above). Exposed verbatim as
  // `analytics.cookieless` below; core itself never reads this beyond that
  // exposure -- see `Analytics.cookieless`'s doc comment for why.
  const cookieless = options.cookieless ?? false;

  // Registered middlewares, in registration order. Populated by `use()`
  // below and consumed by `track`/`page`/`screen` via `runThroughMiddleware`
  // (this issue). `identify`/`group`/`alias`/`reset`/`flush`/`destroy` never
  // read this array -- no canonical event exists for those verbs.
  const middlewares: Middleware[] = [];

  // Phase 11 issue 002: consent state, resolved/seeded once at construction.
  // `defaultState` is inert/unreachable in practice when `options.consent`
  // is `undefined` (the gate below is skipped entirely in that case) --
  // kept only so the closure variable always has a value.
  const defaultState = options.consent ? resolveDefaultState(options.consent) : "denied";
  // Genuinely mutable, reassigned-in-place (not replaced) by
  // `consent.grant()`/`.deny()` below -- never touched by `reset()`, since
  // identity/session reset is independent of consent state (design decision
  // 1, `plan/phase-11-privacy-consent/BRIEF.md`).
  const consentState: ConsentState = { ...options.consent?.initialState };
  const requiredCategories = options.consent?.requiredCategories;

  // Phase 11 issue 005: live closure over `consentState`/`defaultState`,
  // read at call time (never a snapshot) -- passed to `shouldRouteToProvider`
  // (track/page/screen fan-out) and used directly via `isConsentedForProvider`
  // for identify/group/alias's per-provider consent-only gate. Equivalent to
  // `analytics.consent.hasConsent`, defined inline here so it's available
  // before the `analytics` object literal itself is constructed.
  function hasConsentForCategory(category: ConsentCategory): boolean {
    return hasConsent(consentState, category, defaultState);
  }

  // Phase 11 issue 003: the coarse operational kill switch. Defaults to
  // `true` -- matches pre-Phase-11 behavior exactly, so every existing test
  // continues to pass unmodified. Never touched by `reset()`/`destroy()` --
  // an explicit `disable()` stays disabled across a `reset()` (design
  // decision 1, `plan/phase-11-privacy-consent/BRIEF.md`); `destroy()`
  // doesn't need to touch it either, since the instance's usable life is
  // ending anyway.
  let enabled = true;

  // Shared gate for the six data-carrying verbs (`track`/`page`/`screen`/
  // `identify`/`group`/`alias`). When `options.consent` was never supplied,
  // `requiredCategories` is `undefined`, so `isConsentedForCategories`
  // returns `true` vacuously -- zero gating effect, matching this phase's
  // opt-in convention. `enabled` is checked first (cheapest -- a single
  // boolean read) so a disabled instance never even evaluates the
  // consent-category logic -- `enabled` and consent state are fully
  // independent switches, evaluated with AND semantics (issue 003).
  function isTrackingAllowed(): boolean {
    return enabled && isConsentedForCategories(consentState, requiredCategories, defaultState);
  }

  // Shared gate for the five capability-dependent verbs: returns `true` when
  // `entry.provider` both declares the capability and implements the
  // corresponding optional method; `false` otherwise, after emitting exactly
  // one `console.warn` per unique `${provider.name}:${capability}` pair (the
  // first time that pair is seen -- never again for the same pair, even
  // across many calls, and independently per provider in a fan-out list).
  // Never throws.
  function isCapabilitySupported(entry: ProviderEntry, capability: GatedCapability): boolean {
    const provider = entry.provider;
    const method = provider[capability];
    if (provider.capabilities[capability as keyof ProviderCapabilities] && typeof method === "function") {
      return true;
    }
    const key = `${provider.name}:${capability}`;
    if (!warnedCapabilities.has(key)) {
      warnedCapabilities.add(key);
      console.warn(
        `typetrack: provider "${provider.name}" does not support "${capability}" -- ${capability}() call ignored.`,
      );
    }
    return false;
  }

  // Notifies every middleware in `targets` (in registration order) whose
  // `onError` is defined, for a single failure (`error`/`event`/`ctx`).
  // Issue 003's swallow policy: `onError` handlers never propagate -- if
  // calling one throws/rejects, it's caught, `console.warn`'d, and the loop
  // continues to the next middleware's `onError`, so one broken handler
  // never prevents another middleware from being notified of the same
  // failure (and never crashes `track()`/`page()`/`screen()`).
  async function notifyOnError(
    targets: Middleware[],
    error: unknown,
    event: CanonicalEvent,
    ctx: { source: "middleware" | "provider"; providerName?: string },
  ): Promise<void> {
    for (const middleware of targets) {
      if (!middleware.onError) continue;
      try {
        await middleware.onError(error, event, ctx);
      } catch (onErrorFailure) {
        console.warn(
          `typetrack: middleware "${middleware.name}"'s onError() handler itself threw -- ${onErrorFailure}`,
        );
      }
    }
  }

  // Fans a call out to every entry in `entries`, invoking `invoke(entry)`
  // for each (an `invoke` that decides to skip an entry -- routing/
  // capability gating -- simply returns without calling the provider).
  // Every entry's outcome is awaited via `Promise.allSettled`: a rejection
  // (thrown synchronously or a rejected Promise) is swallowed and reported
  // via `console.warn`, mentioning the provider's name, the verb, and the
  // rejection reason -- every failure warns, this is never deduped the way
  // capability warnings are. `dispatchToProviders` itself never rejects.
  //
  // `onProviderError` (issue 003, optional): when supplied, called once per
  // rejected entry, after that entry's `console.warn` has already fired
  // (chosen order -- either is acceptable per the issue, this is the
  // implementation's choice), so `onError` fan-out is additive to, never a
  // replacement for, the existing warning. Only `track`/`page`/`screen`'s
  // call sites pass this (they're the only verbs with a `CanonicalEvent`
  // and a middleware chain); `identify`/`group`/`alias`/`reset` never do, so
  // their behavior is entirely unchanged by this issue.
  async function dispatchToProviders(
    entries: ProviderEntry[],
    verb: string,
    invoke: (entry: ProviderEntry) => void | Promise<void>,
    onProviderError?: (entry: ProviderEntry, error: unknown) => void | Promise<void>,
  ): Promise<void> {
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        await invoke(entry);
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        console.warn(
          `typetrack: provider "${entries[i]!.provider.name}" failed during "${verb}()" -- ${result.reason}`,
        );
        if (onProviderError) {
          await onProviderError(entries[i]!, result.reason);
        }
      }
    }
  }

  // Wraps a single-provider (non-multi) fast path's direct
  // `entry.provider.track/page/screen(event)` call (issue 003): detects a
  // synchronous throw or a rejected returned Promise, and on failure,
  // reports it exactly as `dispatchToProviders` does for the multi-provider
  // case -- `console.warn` (mentioning provider name, verb, rejection
  // reason), then `onError` fan-out to every registered middleware with
  // `source: "provider"` -- then swallows it (the verb resolves normally).
  // On success, `call()`'s own return value (sync `void`, or a `Promise`)
  // passes through untouched -- no extra microtask tick, no forced `Promise`
  // wrapping, preserving the fast path's zero-overhead contract for the
  // non-failing case.
  //
  // Phase 12 issue 003: `verb` is narrowed from `string` to the three
  // literal verbs this function is ever actually called with (`track`/
  // `page`/`screen` -- `identify`/`group`/`alias`/`reset` never call this
  // function at all, only `dispatchToProviders`/direct calls do), since a
  // queued entry (`PersistedQueueEntry.verb`) needs that literal type. Two
  // reliability behaviors are added, both gated on `queueEngine` being
  // defined (i.e. `reliability` was enabled) -- with `reliability`
  // disabled/omitted, `queueEngine` is `undefined` and every branch below
  // is dead code, so behavior is byte-for-byte unchanged from
  // pre-Phase-12: (1) an offline-skip before `call()` is even attempted
  // (silent -- no `console.warn`, being offline isn't a provider
  // misconfiguration); (2) on failure, the existing `console.warn` still
  // fires, but the immediate `notifyOnError` call is replaced by an
  // `enqueue()` for retry -- `onDeadLetter` (constructed above) is the only
  // path that still notifies middleware, deferred until the queue actually
  // gives up.
  function callSingleProvider(
    entry: ProviderEntry,
    verb: "track" | "page" | "screen",
    event: CanonicalEvent,
    call: () => void | Promise<void>,
    priority: number,
  ): void | Promise<void> {
    function handleFailure(error: unknown): Promise<void> {
      console.warn(`typetrack: provider "${entry.provider.name}" failed during "${verb}()" -- ${error}`);
      if (queueEngine) {
        return enqueueEvent({ providerName: entry.provider.name, verb, event, priority });
      }
      return notifyOnError(middlewares, error, event, { source: "provider", providerName: entry.provider.name });
    }

    if (queueEngine && isOffline()) {
      return enqueueEvent({ providerName: entry.provider.name, verb, event, priority });
    }

    try {
      const result = call();
      if (result && typeof (result as Promise<void>).then === "function") {
        return (result as Promise<void>).catch(handleFailure);
      }
      return result;
    } catch (error) {
      return handleFailure(error);
    }
  }

  // Collects rejection reasons from a `Promise.allSettled` fan-out, without
  // swallowing/warning -- distinct contract from `dispatchToProviders`.
  // Every entry still gets the chance to settle (never fail-fast); the
  // caller decides what to do with the returned reasons (issue 004: `flush`/
  // `destroy` throw a combined `AggregateError` if this is non-empty).
  async function settleAll(
    entries: ProviderEntry[],
    invoke: (entry: ProviderEntry) => void | Promise<void>,
  ): Promise<unknown[]> {
    const results = await Promise.allSettled(
      entries.map(async (entry) => {
        await invoke(entry);
      }),
    );
    const reasons: unknown[] = [];
    for (const result of results) {
      if (result.status === "rejected") {
        reasons.push(result.reason);
      }
    }
    return reasons;
  }

  // Shared by `buildEvent()` (`page`/`screen`) and `track()`'s inline
  // canonical-event construction -- both call sites need identical merge
  // logic, so it's factored into this one closure function rather than
  // duplicated inline in two places. Needs access to `staticContext`/
  // `contextOptions`/`sessionStartedAt`/`sessionEventCount` closure state,
  // so it lives here rather than as a standalone pure export the way
  // `src/context.ts`'s functions are.
  //
  // When auto-capture is off (`staticContext` is `undefined`): behavior is
  // byte-for-byte unchanged from pre-Phase-9 -- returns exactly
  // `verbOptions?.context`, no new object allocation, no session-count
  // increment.
  //
  // When auto-capture is on: increments `sessionEventCount`, captures fresh
  // dynamic context, and shallow-merges `{ ...staticContext, ...dynamicContext,
  // session: {...}, ...verbOptions?.context }` -- the caller's `context` is
  // spread last and wins on key collision (not deep-merged: a caller-supplied
  // key fully overwrites the auto-captured value for that key).
  function resolveEventContext(verbOptions: TrackOptions | undefined): Record<string, unknown> | undefined {
    if (!staticContext) {
      return verbOptions?.context;
    }

    sessionEventCount += 1;
    const dynamicContext = captureDynamicContext(contextOptions);
    const durationMs = Date.now() - sessionStartedAt;

    const merged: Record<string, unknown> = {
      ...staticContext,
      ...dynamicContext,
      session: {
        startedAt: sessionStartedAt,
        eventCount: sessionEventCount,
        durationMs,
      },
      ...verbOptions?.context,
    };

    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  function buildEvent(
    name: string | undefined,
    props: Record<string, unknown> | undefined,
    verbOptions: TrackOptions | undefined,
  ): CanonicalEvent {
    return {
      name: name ?? "",
      properties: props ?? {},
      timestamp: Date.now(),
      anonymousId,
      userId,
      sessionId,
      context: resolveEventContext(verbOptions),
      metadata: verbOptions?.metadata,
    };
  }

  // Runs `track`/`page`/`screen`'s canonical event through the registered
  // middleware chain, then `dispatch` (single-provider fast path or
  // Phase 7's routing/fan-out), then `after()`, in the exact order locked by
  // this issue: before-chain -> (drop check) -> dispatch -> after-chain.
  // `dispatch` receives the post-`before`-chain event, so routing/capability
  // gating/provider calls all see the (possibly transformed) event, never
  // the pre-middleware one.
  //
  // Zero-middleware fast path: `runBeforeChain`/`runAfterChain` are skipped
  // entirely (not just no-op'd) so that `dispatch`'s own return value --
  // `void` for the single-provider fast path calling a synchronous
  // provider, or a `Promise<void>` otherwise -- passes through completely
  // unwrapped, keeping zero-middleware behavior byte-for-byte identical to
  // the end of Phase 7 (no extra microtask tick, no forced `Promise` return
  // where none existed before).
  //
  // A `before()` that drops the event (returns `null`/`undefined`) causes
  // this to resolve with no call to `dispatch` and no call to `after()` --
  // the verb resolves normally, exactly as if the app itself never called
  // it for that invocation.
  //
  // Errors thrown by `before()`/`after()` (issue 003): reported via
  // `onError` instead of propagating. A `before()` throw is fanned out to
  // the throwing middleware and every middleware before it in registration
  // order (`before.ranMiddlewares` -- the chain never reaches later
  // middlewares, mirroring a drop's short-circuit), then treated like a
  // drop (no `dispatch`, no `after`). An `after()` throw is fanned out
  // identically (`after.ranMiddlewares`), but `dispatch` has already run by
  // that point -- the event was genuinely delivered, this isn't a drop.
  // Provider-dispatch rejections are handled inside `dispatch` itself (see
  // `dispatchToProviders`'s `onProviderError` / `callSingleProvider`) --
  // this function never needs to know about those.
  function runThroughMiddleware(
    canonicalEvent: CanonicalEvent,
    dispatch: (event: CanonicalEvent) => void | Promise<void>,
  ): void | Promise<void> {
    if (middlewares.length === 0) {
      return dispatch(canonicalEvent);
    }

    return (async () => {
      const before = await runBeforeChain(middlewares, canonicalEvent);
      if (before.threw) {
        await notifyOnError(before.ranMiddlewares, before.error, before.event, { source: "middleware" });
        return;
      }
      if (before.dropped) return;

      await dispatch(before.event);

      const after = await runAfterChain(middlewares, before.event);
      if (after.threw) {
        await notifyOnError(after.ranMiddlewares, after.error, before.event, { source: "middleware" });
      }
    })();
  }

  // ---------------------------------------------------------------------
  // Phase 12 issue 003: reliability (offline queue/retry/dead-letter)
  // construction-time wiring. Everything in this section is a no-op when
  // `options.reliability` was never supplied/truthy -- `queueEngine` stays
  // `undefined`, and every call site below that reads it (`isOffline()`
  // gates on it too) degrades to exactly pre-Phase-12 behavior.
  // ---------------------------------------------------------------------

  const reliabilityOptions = resolveReliabilityOptions(options.reliability);

  // `undefined` until (and unless) the block below constructs one -- every
  // call site treats "`queueEngine` is `undefined`" as the single source of
  // truth for "reliability is off", rather than re-checking
  // `reliabilityOptions` independently.
  let queueEngine: QueueEngine | undefined;
  let drainIntervalHandle: ReturnType<typeof setInterval> | undefined;
  let onlineListener: (() => void) | undefined;
  // Resolves once `queueEngine.hydrate()` (fire-and-forget, kicked off
  // below) settles -- `hydrate()` never rejects (issue 002's own contract:
  // a hydration failure is caught internally and logged, `entries` falls
  // back to `[]`), so this is safe to `.then()` off of unconditionally.
  // `undefined` until the reliability block below assigns it.
  let hydratePromise: Promise<void> | undefined;

  // Phase 12 issue 003: every `queueEngine.enqueue()` call in this file
  // goes through this wrapper rather than calling `queueEngine.enqueue()`
  // directly -- necessary to avoid a genuine race against `hydrate()`
  // (also fire-and-forget): `hydrate()`'s `entries = await storage.load()`
  // unconditionally *replaces* the in-memory queue array once storage
  // finishes loading. Without this sequencing, an `enqueue()` call that
  // happens to synchronously mutate `entries` *before* that reassignment
  // resolves (e.g. an offline-skip on the very first `track()` call,
  // microtask-scheduled right alongside `hydrate()`'s own kickoff) would
  // have its freshly-pushed entry silently clobbered back out by
  // `hydrate()`'s stale pre-load snapshot landing afterwards. Chaining
  // every `enqueue()` off of `hydratePromise` guarantees hydration's
  // one-time reassignment always happens-before any of this session's own
  // enqueues, so nothing pushed during a session is ever lost -- this is
  // strictly about *this* session's own writes; it does not change (and is
  // not needed for) the already-documented, accepted "prior-session
  // entries may not be visible for the first few hundred milliseconds"
  // tradeoff of `hydrate()` itself being fire-and-forget.
  function enqueueEvent(
    entry: Omit<PersistedQueueEntry, "id" | "attempts" | "enqueuedAt" | "nextAttemptAt">,
  ): Promise<void> {
    if (!queueEngine) return Promise.resolve();
    const engine = queueEngine;
    return (hydratePromise ?? Promise.resolve()).then(() => engine.enqueue(entry));
  }

  // Phase 12 issue 003: a drain tick independent of any individual entry's
  // own `nextAttemptAt` backoff (`peekReady`'s own filtering enforces
  // that) -- 5s is a reasonable balance between promptness and needless
  // polling for a queue whose whole purpose is bridging brief offline
  // gaps/transient failures, not a tight real-time delivery guarantee.
  const DRAIN_INTERVAL_MS = 5000;

  // Phase 12 issue 003: best-effort, never-throws offline check -- mirrors
  // Phase 11's `detectBrowserPrivacySignal` convention (see
  // `src/consent.ts`) exactly: outside a browser environment, or when
  // `navigator.onLine` is unavailable/`true`, this is never considered
  // offline. `navigator` isn't an ambient type here (no `"dom"` in this
  // package's `tsconfig.json` `lib`, see `src/context.ts`'s header
  // comment) -- read via the same ad-hoc-minimal-shape-off-`globalThis`
  // convention as every other browser-global read in this codebase.
  function isOffline(): boolean {
    try {
      if (!isBrowserEnvironment()) return false;
      const navigator = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
      return navigator?.onLine === false;
    } catch {
      return false;
    }
  }

  // Phase 12 issue 005 defaults for `ReliabilityOptions.batch` -- see that
  // field's doc comment above.
  const DEFAULT_BATCH_SIZE = 10;
  const DEFAULT_BATCH_INTERVAL_MS = 5000;

  // Phase 12 issue 003: drains a single ready entry (one `track`/`page`/
  // `screen` call), recording success/failure against `queueEngine`
  // exactly as before this issue's batching support was added. Used both
  // by non-batch-capable/single-entry groups below, and is the sole drain
  // path when batching was never a consideration at all.
  async function drainSingleEntry(entry: PersistedQueueEntry, provider: AnalyticsProvider): Promise<void> {
    if (!queueEngine) return;
    try {
      if (entry.verb === "track") {
        await provider.track(entry.event);
      } else if (entry.verb === "page") {
        if (!provider.page) {
          throw new Error(`typetrack: provider "${provider.name}" no longer supports "page()"`);
        }
        await provider.page(entry.event);
      } else {
        if (!provider.screen) {
          throw new Error(`typetrack: provider "${provider.name}" no longer supports "screen()"`);
        }
        await provider.screen(entry.event);
      }
      await queueEngine.recordSuccess(entry.id);
    } catch (error) {
      await queueEngine.recordFailure(entry.id, error);
    }
  }

  // Phase 12 issue 003 (extended by issue 005): drains every currently-
  // "ready" entry once. The interval tick and the `online` listener both
  // call this with `bypassBackoff: false` (each entry's own `nextAttemptAt`
  // gate applies, via `peekReady(Date.now())`); `flush()` calls this with
  // `bypassBackoff: true` (BRIEF.md decision 8 -- an explicit `flush()` is
  // the app's signal that "now is a good time to try", not something that
  // should wait out a backoff timer). The provider lookup is by name, live,
  // every call (design decision) -- not a reference captured at enqueue
  // time -- so a provider looked up here always reflects the *current*
  // `normalized.entries`, not whatever was configured when the entry was
  // first queued.
  //
  // Issue 005: `readyEntries` (already priority/FIFO-sorted by
  // `peekReady()`) is grouped by `providerName`, preserving that same
  // relative order within each group. A group is sent through
  // `provider.trackBatch()` (one call per chunk, chunked via
  // `chunkForBatching()`) only when the live provider both declares
  // `capabilities.batch === true` and implements `trackBatch`, *and* the
  // group has `>= 2` ready entries -- a lone ready entry never goes through
  // `trackBatch`, matching a non-batch-capable provider's own one-at-a-time
  // path exactly (`drainSingleEntry`). A `trackBatch` chunk's success/
  // failure is applied uniformly to every entry in that chunk (no
  // per-event status exists in the `trackBatch` contract) -- see
  // `AnalyticsProvider.trackBatch`'s doc comment in `src/providers/index.ts`.
  async function drainQueueOnce(dropOptions?: { bypassBackoff?: boolean }): Promise<void> {
    if (!queueEngine) return;

    const readyEntries = dropOptions?.bypassBackoff
      ? queueEngine.peekReady(Number.POSITIVE_INFINITY)
      : queueEngine.peekReady(Date.now());

    const now = Date.now();
    const batchSize = reliabilityOptions?.batch?.size ?? DEFAULT_BATCH_SIZE;
    const batchIntervalMs = reliabilityOptions?.batch?.intervalMs ?? DEFAULT_BATCH_INTERVAL_MS;

    // Groups `readyEntries` by `providerName`, preserving the incoming
    // (priority/FIFO) order within each group -- a plain `Map` naturally
    // keeps insertion order both across groups and within each group's
    // array, so no extra sort is needed here.
    const groups = new Map<string, PersistedQueueEntry[]>();
    for (const entry of readyEntries) {
      const group = groups.get(entry.providerName);
      if (group) {
        group.push(entry);
      } else {
        groups.set(entry.providerName, [entry]);
      }
    }

    for (const [providerName, groupEntries] of groups) {
      const matchingEntry = normalized.entries.find(
        (candidate) => candidate.provider.name === providerName,
      );

      if (!matchingEntry) {
        // BRIEF.md decision 3: no instant drop -- this still goes through
        // normal `maxAttempts` exhaustion (via `recordFailure`), keeping the
        // dead-letter/warning path uniform rather than special-casing an
        // immediate silent drop. Applied per-entry -- unrelated to
        // batching (there is no provider to call `trackBatch` on).
        for (const entry of groupEntries) {
          await queueEngine.recordFailure(
            entry.id,
            new Error(`typetrack: provider "${providerName}" is no longer configured`),
          );
        }
        continue;
      }

      const provider = matchingEntry.provider;
      const batchCapable = provider.capabilities.batch === true && typeof provider.trackBatch === "function";

      if (batchCapable && groupEntries.length >= 2) {
        const chunks = chunkForBatching(groupEntries, batchSize, batchIntervalMs, now);
        for (const chunk of chunks) {
          try {
            await provider.trackBatch!(chunk.map((entry) => entry.event));
            for (const entry of chunk) {
              await queueEngine.recordSuccess(entry.id);
            }
          } catch (error) {
            for (const entry of chunk) {
              await queueEngine.recordFailure(entry.id, error);
            }
          }
        }
        continue;
      }

      // Not batch-capable, or a lone ready entry -- exactly issue 003's
      // one-call-per-entry path.
      for (const entry of groupEntries) {
        await drainSingleEntry(entry, provider);
      }
    }
  }

  if (reliabilityOptions) {
    // Phase 12 issue 003: a per-instance stable prefix, generated once here
    // and reused for both the storage key (localStorage) and DB/store name
    // (IndexedDB) for this instance's entire lifetime. `CreateAnalyticsOptions`
    // has no app-supplied stable identifier for an `Analytics` instance
    // today (no `name`/`appId`-style option exists anywhere), so a random
    // suffix generated once at construction is this issue's chosen scheme --
    // it keeps two simultaneously-constructed `Analytics` instances in the
    // same app from silently sharing (and corrupting) one another's
    // persisted queue.
    const instancePrefix = `typetrack-${crypto.randomUUID()}`;

    const storageKind = reliabilityOptions.storage ?? "auto";
    const storage: QueueStorageAdapter =
      storageKind === "indexeddb"
        ? createIndexedDbStorageAdapter(`${instancePrefix}-queue`, "queue")
        : storageKind === "localstorage"
          ? createLocalStorageAdapter(`${instancePrefix}-queue`)
          : storageKind === "memory"
            ? createMemoryStorageAdapter()
            : detectBestStorage(instancePrefix);

    queueEngine = createQueueEngine({
      storage,
      maxQueueSize: reliabilityOptions.maxQueueSize,
      maxAttempts: reliabilityOptions.maxAttempts,
      backoff: reliabilityOptions.backoff,
      onDeadLetter(entry, reason) {
        // Deferred `notifyOnError` (issue 003 design decision): fires
        // exactly once, at exhaustion -- never on an intermediate retry
        // attempt. Reuses the exact same `notifyOnError` helper
        // `callSingleProvider`/`dispatchToProviders` already call for a
        // same-tick failure, so a dead-lettered event surfaces through the
        // identical middleware `onError` channel, just later.
        void notifyOnError(middlewares, reason, entry.event, {
          source: "provider",
          providerName: entry.providerName,
        });
      },
    });

    // Fire-and-forget (issue 003 design decision): `createAnalytics()`
    // stays synchronous -- every prior phase's contract. This means a
    // freshly-constructed instance's queue may not reflect prior-session
    // persisted entries for the first few hundred milliseconds after
    // construction; the background drain loop's first tick (or an
    // immediate `flush()`/`analytics.queue.drain()` call) naturally picks
    // up whatever hydration completed by then. Documented tradeoff, not a
    // bug. `hydratePromise` is still captured (not discarded) so
    // `enqueueEvent()` above can sequence this session's own enqueues
    // after it -- see that function's comment for why.
    hydratePromise = queueEngine.hydrate();

    drainIntervalHandle = setInterval(() => {
      void drainQueueOnce();
    }, DRAIN_INTERVAL_MS);

    // Coming back online should not wait for the next timer tick.
    if (isBrowserEnvironment()) {
      onlineListener = () => {
        void drainQueueOnce();
      };
      (globalThis as { window?: { addEventListener?: (type: string, listener: () => void) => void } }).window
        ?.addEventListener?.("online", onlineListener);
    }
  }

  const analytics: Analytics<Events> = {
    track(event, ...args) {
      // Phase 11 issue 002: consent gate, the very first statement --
      // before anything else, including the dev-server-mirror `fetch()`
      // call below. When blocked, returns `undefined` immediately,
      // synchronously: no provider call, no middleware run, no dev-server
      // mirror, no schema validation. This is a deliberate behavior change
      // to the dev-server mirror's previously-unconditional timing (see
      // issue 001/002) -- it now only fires once tracking is allowed.
      if (!isTrackingAllowed()) return undefined;

      const [rawPayload, trackOptions] = args as [unknown, TrackOptions | undefined];

      // Fire-and-forget mirror to the dev server, dispatched with the raw,
      // unvalidated payload before schema validation runs below -- must fire
      // regardless of whether a schema exists, whether validation
      // succeeds/fails, or whether `onValidationError` is set (but only once
      // the consent gate above has allowed this call through at all). Never
      // returned/awaited; any failure (rejected fetch, non-2xx, no listener)
      // is silently swallowed with no default logging.
      if (devServerUrl) {
        void fetch(devServerUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event, payload: rawPayload }),
        }).catch(() => {});
      }

      const schema = schemas?.[event];
      let payload: Record<string, unknown>;
      if (schema) {
        const result = schema.safeParse(rawPayload);
        if (!result.success) {
          const error = new EventValidationError(event as string, rawPayload, result.error);
          if (onValidationError) {
            onValidationError(error);
            return;
          }
          throw error;
        }
        payload = (result.data ?? {}) as Record<string, unknown>;
      } else {
        payload = (rawPayload ?? {}) as Record<string, unknown>;
      }

      const canonicalEvent: CanonicalEvent = {
        name: event as string,
        properties: payload,
        timestamp: Date.now(),
        anonymousId,
        userId,
        sessionId,
        context: resolveEventContext(trackOptions),
        metadata: trackOptions?.metadata,
      };

      return runThroughMiddleware(canonicalEvent, (evt) => {
        // `track()` is never capability-gated -- `AnalyticsProvider.track`
        // is a required (non-optional) field, always called directly.
        // Phase 12 issue 004: threaded from `track()`'s `trackOptions`
        // argument -- falls back to `0` when the caller didn't pass one,
        // matching issue 003's pre-this-issue hardcoded behavior exactly.
        const priority = trackOptions?.priority ?? 0;

        if (!normalized.isMulti) {
          const entry = normalized.entries[0]!;
          return callSingleProvider(entry, "track", evt, () => entry.provider.track(evt), priority);
        }

        const sorted = sortByPriority(normalized.entries);
        return dispatchToProviders(
          sorted,
          "track",
          (entry) => {
            // Routing is evaluated before anything else: an entry excluded by
            // routing is never a candidate for the call at all, so it never
            // triggers a capability warning either (moot here since `track`
            // isn't capability-gated, but keeps the same order as page/screen).
            // `evt` is the post-`before`-chain event -- routing sees the
            // (possibly transformed) event, never the pre-middleware one.
            if (!shouldRouteToProvider(entry, evt, hasConsentForCategory)) return;
            // Phase 12 issue 003: offline-skip, checked before attempting the
            // call at all -- silent (no console.warn; being offline isn't a
            // provider misconfiguration). Dead when `queueEngine` is
            // `undefined` (reliability disabled/omitted).
            if (queueEngine && isOffline()) {
              return enqueueEvent({ providerName: entry.provider.name, verb: "track", event: evt, priority });
            }
            return entry.provider.track(evt);
          },
          (entry, error) => {
            // Phase 12 issue 003: on failure, enqueue for retry instead of
            // immediately notifying middleware -- `onDeadLetter` (constructed
            // above) defers that notification until the queue actually gives
            // up. Dead when `queueEngine` is `undefined`, in which case this
            // is byte-for-byte the pre-Phase-12 `notifyOnError` call.
            if (queueEngine) {
              return enqueueEvent({ providerName: entry.provider.name, verb: "track", event: evt, priority });
            }
            return notifyOnError(middlewares, error, evt, { source: "provider", providerName: entry.provider.name });
          },
        );
      });
    },
    identify(newUserId, traits) {
      // Phase 11 issue 004: anonymousMode gate, checked *before* issue 002's
      // consent gate -- cheapest check first (a single boolean read needs no
      // consent-state evaluation). Both checks independently produce a
      // no-op, so the order is unobservable to the caller; this order is
      // picked purely for consistency/cheapness. A complete no-op beyond a
      // one-time warning: `userId` is left untouched, no provider is called.
      if (anonymousMode) {
        if (!warnedAnonymousMode.has("identify")) {
          warnedAnonymousMode.add("identify");
          console.warn("typetrack: anonymousMode is enabled -- identify() call ignored.");
        }
        return undefined;
      }

      // Phase 11 issue 002: consent gate, the very first statement -- before
      // even the `userId` reassignment below. When blocked, `userId` is left
      // untouched and no provider call is made.
      if (!isTrackingAllowed()) return undefined;

      // `identify()` is the only verb that updates core's current `userId`.
      userId = newUserId;

      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        // Phase 11 issue 005: consent-only gate (not full routing -- see
        // module doc comment), checked before the capability check so a
        // consent-denied provider never triggers a capability warning. This
        // branch's `entry` is always `{ provider }` (no `requiresConsent`
        // possible via the bare-provider fast path), so this is vacuously
        // `true` here -- kept for consistency with the multi-provider branch
        // below, which needs the real check.
        if (!isConsentedForProvider(entry.requiresConsent, hasConsentForCategory)) return;
        if (!isCapabilitySupported(entry, "identify")) return;
        return entry.provider.identify?.(newUserId, traits, anonymousId);
      }

      // Always fans out to every provider unconditionally -- no routing
      // evaluation for identify/group/alias/reset. Original array order is
      // used (not `sortByPriority`): priority ordering only matters for the
      // routable verbs (track/page/screen), where call order interacts with
      // routing/sampling side effects; the always-fan-out verbs have no such
      // interaction; iterating in original declared order is simpler and
      // keeps ordering predictable to callers who declared their array in a
      // particular order.
      return dispatchToProviders(normalized.entries, "identify", (entry) => {
        // Phase 11 issue 005: consent-only gate, evaluated before capability
        // (see comment above) -- `include`/`exclude`/`predicate`/`sampling`
        // remain deliberately unevaluated for this verb (Phase 7 decision).
        if (!isConsentedForProvider(entry.requiresConsent, hasConsentForCategory)) return;
        if (!isCapabilitySupported(entry, "identify")) return;
        return entry.provider.identify?.(newUserId, traits, anonymousId);
      });
    },
    page(name, props, pageOptions) {
      // Phase 11 issue 002: consent gate, the very first statement.
      if (!isTrackingAllowed()) return undefined;

      const canonicalEvent = buildEvent(name, props, pageOptions);

      return runThroughMiddleware(canonicalEvent, (evt) => {
        // Phase 12 issue 004: threaded from `page()`'s `pageOptions`
        // argument -- see `track()`'s matching comment above.
        const priority = pageOptions?.priority ?? 0;

        if (!normalized.isMulti) {
          const entry = normalized.entries[0]!;
          if (!isCapabilitySupported(entry, "page")) return;
          return callSingleProvider(entry, "page", evt, () => entry.provider.page?.(evt), priority);
        }

        const sorted = sortByPriority(normalized.entries);
        return dispatchToProviders(
          sorted,
          "page",
          (entry) => {
            if (!shouldRouteToProvider(entry, evt, hasConsentForCategory)) return;
            if (!isCapabilitySupported(entry, "page")) return;
            // Phase 12 issue 003: offline-skip -- see `track()`'s matching
            // comment above for the full rationale.
            if (queueEngine && isOffline()) {
              return enqueueEvent({ providerName: entry.provider.name, verb: "page", event: evt, priority });
            }
            return entry.provider.page?.(evt);
          },
          (entry, error) => {
            // Phase 12 issue 003: enqueue-for-retry instead of an immediate
            // `notifyOnError` -- see `track()`'s matching comment above.
            if (queueEngine) {
              return enqueueEvent({ providerName: entry.provider.name, verb: "page", event: evt, priority });
            }
            return notifyOnError(middlewares, error, evt, { source: "provider", providerName: entry.provider.name });
          },
        );
      });
    },
    group(groupId, traits) {
      // Phase 11 issue 002: consent gate, the very first statement.
      if (!isTrackingAllowed()) return undefined;

      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        // Phase 11 issue 005: consent-only gate, before capability -- see
        // identify()'s matching comment above.
        if (!isConsentedForProvider(entry.requiresConsent, hasConsentForCategory)) return;
        if (!isCapabilitySupported(entry, "group")) return;
        return entry.provider.group?.(groupId, traits, { userId, anonymousId });
      }

      return dispatchToProviders(normalized.entries, "group", (entry) => {
        if (!isConsentedForProvider(entry.requiresConsent, hasConsentForCategory)) return;
        if (!isCapabilitySupported(entry, "group")) return;
        return entry.provider.group?.(groupId, traits, { userId, anonymousId });
      });
    },
    alias(newUserId, previousUserId) {
      // Phase 11 issue 004: anonymousMode gate, checked before issue 002's
      // consent gate -- see identify()'s matching comment above for the
      // ordering rationale. A complete no-op beyond a one-time warning.
      if (anonymousMode) {
        if (!warnedAnonymousMode.has("alias")) {
          warnedAnonymousMode.add("alias");
          console.warn("typetrack: anonymousMode is enabled -- alias() call ignored.");
        }
        return undefined;
      }

      // Phase 11 issue 002: consent gate, the very first statement.
      if (!isTrackingAllowed()) return undefined;

      // Does not mutate core's stored `userId` -- only `identify()` does.
      if (!normalized.isMulti) {
        const entry = normalized.entries[0]!;
        // Phase 11 issue 005: consent-only gate, before capability -- see
        // identify()'s matching comment above.
        if (!isConsentedForProvider(entry.requiresConsent, hasConsentForCategory)) return;
        if (!isCapabilitySupported(entry, "alias")) return;
        return entry.provider.alias?.(newUserId, previousUserId, anonymousId);
      }

      return dispatchToProviders(normalized.entries, "alias", (entry) => {
        if (!isConsentedForProvider(entry.requiresConsent, hasConsentForCategory)) return;
        if (!isCapabilitySupported(entry, "alias")) return;
        return entry.provider.alias?.(newUserId, previousUserId, anonymousId);
      });
    },
    screen(name, props, screenOptions) {
      // Phase 11 issue 002: consent gate, the very first statement.
      if (!isTrackingAllowed()) return undefined;

      const canonicalEvent = buildEvent(name, props, screenOptions);

      return runThroughMiddleware(canonicalEvent, (evt) => {
        // Phase 12 issue 004: threaded from `screen()`'s `screenOptions`
        // argument -- see `track()`'s matching comment above.
        const priority = screenOptions?.priority ?? 0;

        if (!normalized.isMulti) {
          const entry = normalized.entries[0]!;
          if (!isCapabilitySupported(entry, "screen")) return;
          return callSingleProvider(entry, "screen", evt, () => entry.provider.screen?.(evt), priority);
        }

        const sorted = sortByPriority(normalized.entries);
        return dispatchToProviders(
          sorted,
          "screen",
          (entry) => {
            if (!shouldRouteToProvider(entry, evt, hasConsentForCategory)) return;
            if (!isCapabilitySupported(entry, "screen")) return;
            // Phase 12 issue 003: offline-skip -- see `track()`'s matching
            // comment above for the full rationale.
            if (queueEngine && isOffline()) {
              return enqueueEvent({ providerName: entry.provider.name, verb: "screen", event: evt, priority });
            }
            return entry.provider.screen?.(evt);
          },
          (entry, error) => {
            // Phase 12 issue 003: enqueue-for-retry instead of an immediate
            // `notifyOnError` -- see `track()`'s matching comment above.
            if (queueEngine) {
              return enqueueEvent({ providerName: entry.provider.name, verb: "screen", event: evt, priority });
            }
            return notifyOnError(middlewares, error, evt, { source: "provider", providerName: entry.provider.name });
          },
        );
      });
    },
    reset() {
      // Eager, not lazy: identity is reassigned before any provider's
      // `reset?.()` is invoked. Not capability-gated -- this is a lifecycle
      // hook, not a data verb, and `ProviderCapabilities` has no `reset`
      // field. Not consent-gated either -- `reset()` deliberately never
      // touches `consentState`/`defaultState`/`requiredCategories`:
      // identity/session reset is independent of consent state (Phase 11
      // issue 002, design decision 1 in `plan/phase-11-privacy-consent/BRIEF.md`).
      anonymousId = crypto.randomUUID();
      sessionId = crypto.randomUUID();
      userId = undefined;
      // A fresh session context starts counting from zero again, consistent
      // with `sessionId` itself being reassigned above.
      sessionStartedAt = Date.now();
      sessionEventCount = 0;

      if (!normalized.isMulti) {
        return normalized.entries[0]!.provider.reset?.();
      }

      return dispatchToProviders(normalized.entries, "reset", (entry) => entry.provider.reset?.());
    },
    async flush() {
      // Phase 12 issue 003 / BRIEF.md decision 8: an explicit `flush()` call
      // drains the reliability queue immediately, bypassing every entry's
      // own `nextAttemptAt` backoff gate (`drainQueueOnce({ bypassBackoff:
      // true })` calls `peekReady(Number.POSITIVE_INFINITY)` rather than
      // `peekReady(Date.now())`) -- an app calling `flush()` is signaling
      // "now is a good time to try", not something that should wait out a
      // backoff timer. Runs before the existing per-provider `flush()`
      // calls below. A no-op when `queueEngine` is `undefined` (reliability
      // disabled/omitted).
      if (queueEngine) {
        await drainQueueOnce({ bypassBackoff: true });
      }

      if (!normalized.isMulti) {
        await normalized.entries[0]!.provider.flush?.();
        return;
      }

      // Unlike every other fan-out verb, `flush`/`destroy` do not
      // swallow-and-warn: every provider still gets the chance to settle
      // (never fail-fast), but a non-empty rejection list is thrown as a
      // real `AggregateError` -- no `console.warn` on this path, which would
      // double-report the same failures.
      const reasons = await settleAll(normalized.entries, (entry) => entry.provider.flush?.());
      if (reasons.length > 0) {
        throw new AggregateError(reasons, `typetrack: ${reasons.length} provider(s) failed during flush()`);
      }
    },
    async destroy() {
      // Plugin teardowns run first, in registration order, before any
      // provider flush/destroy work begins -- stops plugins from generating
      // new track()/page() calls while providers are mid-teardown. A
      // throwing teardown is swallowed and reported via console.warn (same
      // pattern as the rest of this function's swallow-and-warn
      // conventions); it does not join the AggregateError below, and never
      // prevents the remaining teardowns or the provider flush/destroy
      // phases from running.
      for (const teardown of pluginTeardowns) {
        try {
          teardown();
        } catch (error) {
          console.warn(`typetrack: a plugin's teardown threw during destroy() -- ${error}`);
        }
      }

      // Phase 12 issue 003 / BRIEF.md decision 8: stops the background
      // drain timer and removes the `online` listener -- does *not* itself
      // call `drainQueueOnce()` (an app tearing down isn't necessarily
      // online/able to flush; draining here would silently attempt network
      // calls mid-teardown). Any still-queued entries are left in storage
      // -- a future `createAnalytics()` construction against the same
      // storage picks them back up (BRIEF.md decision 9). No-op when
      // reliability was never enabled (both handles stay `undefined`).
      if (drainIntervalHandle !== undefined) {
        clearInterval(drainIntervalHandle);
        drainIntervalHandle = undefined;
      }
      if (onlineListener) {
        (
          globalThis as { window?: { removeEventListener?: (type: string, listener: () => void) => void } }
        ).window?.removeEventListener?.("online", onlineListener);
        onlineListener = undefined;
      }

      // Drain first, then tear down, per provider. Not capability-gated.
      if (!normalized.isMulti) {
        await normalized.entries[0]!.provider.flush?.();
        await normalized.entries[0]!.provider.destroy?.();
        return;
      }

      // Two phases across the whole array: every provider's flush is
      // allowed to settle first (collecting rejections, not throwing yet),
      // then every provider's destroy runs regardless of whether that same
      // provider's flush rejected -- teardown is not optional just because
      // draining failed. Rejections from both phases are combined into one
      // `AggregateError`, thrown only after both phases have fully settled.
      const flushReasons = await settleAll(normalized.entries, (entry) => entry.provider.flush?.());
      const destroyReasons = await settleAll(normalized.entries, (entry) => entry.provider.destroy?.());
      const reasons = [...flushReasons, ...destroyReasons];
      if (reasons.length > 0) {
        throw new AggregateError(reasons, `typetrack: ${reasons.length} provider(s) failed during destroy()`);
      }
    },
    use(middleware) {
      middlewares.push(middleware);
    },
    consent: {
      grant(...categories) {
        for (const category of categories) {
          consentState[category] = "granted";
        }
      },
      deny(...categories) {
        for (const category of categories) {
          consentState[category] = "denied";
        }
      },
      hasConsent(category) {
        return hasConsent(consentState, category, defaultState);
      },
      get() {
        // Shallow-cloned snapshot -- mutating the returned object never
        // affects internal state (see `ConsentController.get()`'s doc
        // comment above).
        return { ...consentState };
      },
    },
    // Phase 11 issue 003: the coarse kill switch. No `console.warn` on a
    // disabled instance's blocked calls -- unlike the capability-gating
    // pattern, this is expected, deliberate, high-frequency behavior (e.g.
    // every `track()` call while paused), not a misconfiguration worth
    // flagging.
    enable() {
      enabled = true;
    },
    disable() {
      enabled = false;
    },
    isEnabled() {
      return enabled;
    },
    // Phase 11 issue 006: plain readonly property, set once here and never
    // reassigned -- see `Analytics.cookieless`'s doc comment.
    cookieless,
    // Phase 12 issue 003: always present -- see `QueueController`'s doc
    // comment. `size()`/`drain()`/`clear()` are all complete no-ops when
    // `queueEngine` is `undefined` (reliability disabled/omitted):
    // `size()` returns `0`, `drain()` resolves immediately (`drainQueueOnce`
    // itself no-ops on an `undefined` `queueEngine`), `clear()` does
    // nothing.
    queue: {
      size() {
        return queueEngine?.size() ?? 0;
      },
      async drain() {
        await drainQueueOnce();
      },
      clear() {
        void queueEngine?.clear();
      },
    },
  };

  // Plugins are invoked once, in array order, here -- after `analytics` is
  // fully constructed (every verb is callable from inside a plugin at setup
  // time) but before `createAnalytics()` returns. A throwing plugin setup is
  // swallowed and reported via `console.warn` (never propagates out of
  // `createAnalytics()`, never blocks a later plugin in the array from
  // running) -- mirrors the "never throw" contract established by Phase 9's
  // context capture and Phase 8's middleware `onError` handling.
  // `plugin.name` relies on `Function.prototype.name` -- see `src/plugins.ts`
  // for why every shipped plugin factory must return a named function
  // expression, not an anonymous arrow, for this warning to be legible.
  const pluginTeardowns: (() => void)[] = [];
  for (const plugin of options.plugins ?? []) {
    try {
      const teardown = plugin(analytics);
      if (teardown) pluginTeardowns.push(teardown);
    } catch (error) {
      console.warn(`typetrack: plugin "${plugin.name || "<anonymous>"}" threw during setup -- ${error}`);
    }
  }

  return analytics;
}
