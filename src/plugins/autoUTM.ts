// Built-in `autoUTM` plugin (Phase 10 issue 005): browser-only, one-shot
// first-touch campaign attribution. Distinct from Phase 9's existing
// `context: true` auto-capture (`src/context.ts`'s `captureDynamicContext`,
// which live-annotates every `track`/`page`/`screen` event's
// `context.campaign` from the *current* URL, gone again once the app
// navigates away from it) -- this plugin instead captures the UTM params
// present on the very first page load of a session, **persists** them
// (`sessionStorage`) so campaign attribution survives past that first URL,
// and fires exactly one dedicated "Campaign Landing" event at that moment.
// It does not touch any other event's `context` -- see this phase's issue
// 005 for the full locked grill-me split between the two features.
//
// Reuses `src/context.ts`'s `parseCampaign` (now exported for this purpose)
// rather than re-implementing the same 5-UTM-param mapping a second time.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (see `src/context.ts`'s header comment) -- `location`/`sessionStorage`
// aren't ambient types here either. The minimal ad-hoc shapes below are read
// directly off `globalThis` (top-level, not nested under a `window` object),
// matching `src/context.ts`/`autoPage.ts`'s precedent, and are exactly the
// shape a test needs to stub via `Object.defineProperty(globalThis, ...)`.
import type { Plugin } from "../plugins";
import { isBrowserEnvironment, parseCampaign } from "../context";

const DEFAULT_STORAGE_KEY = "typetrack_first_touch_campaign";

export interface AutoUTMOptions {
  // sessionStorage key used to persist the first-touch campaign params.
  // Defaults to "typetrack_first_touch_campaign".
  storageKey?: string;
}

interface MinimalLocation {
  search?: string;
}

interface MinimalStorage {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}

interface MinimalBrowserGlobal {
  location?: MinimalLocation;
  sessionStorage?: MinimalStorage;
}

function browserGlobal(): MinimalBrowserGlobal {
  return globalThis as unknown as MinimalBrowserGlobal;
}

// Best-effort read of a previously-persisted first-touch campaign value --
// `true` if a (string) value is present under `storageKey`. Never throws --
// `sessionStorage.getItem` can throw in some private-browsing modes; treated
// identically to "nothing persisted" on failure. The caller doesn't act
// differently on `true` vs `false` today (both result in doing nothing
// further -- see the no-UTM-params branch below), but the read itself still
// happens, matching this plugin's documented algorithm and giving a stubbed
// `sessionStorage.getItem` that throws something real to guard against.
function readPersistedCampaign(storage: MinimalStorage | undefined, storageKey: string): boolean {
  try {
    return typeof storage?.getItem?.(storageKey) === "string";
  } catch {
    return false;
  }
}

// Best-effort persistence -- guarded separately from the read above (and
// from the `analytics.track()` call itself) so a `sessionStorage.setItem`
// failure only affects persistence, never the landing event.
function persistCampaign(
  storage: MinimalStorage | undefined,
  storageKey: string,
  campaign: Record<string, string | undefined>,
): void {
  try {
    storage?.setItem?.(storageKey, JSON.stringify(campaign));
  } catch {
    // Never throw -- e.g. sessionStorage disabled/full in some
    // private-browsing modes.
  }
}

// Browser-only, one-shot (no listeners, no teardown -- setup returns
// undefined). On setup:
//   - Parses UTM params from the current location.search via
//     parseCampaign() (src/context.ts, Phase 9).
//   - If present: persists them to sessionStorage under storageKey (JSON,
//     guarded by try/catch -- sessionStorage can throw in some private-
//     browsing modes) and fires exactly one
//     analytics.track("Campaign Landing", campaign) call. This re-fires
//     on every setup where UTM params are genuinely present in the current
//     URL (e.g. a full page reload with the same UTM query string still
//     attached) -- the persisted-value check below only guards the
//     *no-params-in-URL* branch.
//   - If absent from the current URL: checks sessionStorage for a
//     previously-persisted value from an earlier page load THIS SESSION.
//     If found, does nothing further (the landing event already fired
//     earlier in this session for the real first touch -- this is not a
//     new landing, just a later page in the same session with no UTM
//     params of its own). If nothing is persisted either, does nothing
//     (this is a session with no campaign attribution at all).
// Never throws, regardless of sessionStorage availability or malformed
// stored data.
export function autoUTM(options?: AutoUTMOptions): Plugin {
  const storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;

  return function autoUTMSetup(analytics): undefined {
    if (!isBrowserEnvironment()) return undefined;

    const g = browserGlobal();
    const storage = g.sessionStorage;

    let campaign: ReturnType<typeof parseCampaign>;
    try {
      campaign = parseCampaign(g.location?.search ?? "");
    } catch {
      campaign = undefined;
    }

    if (campaign) {
      persistCampaign(storage, storageKey, campaign);
      analytics.track("Campaign Landing", campaign);
      return undefined;
    }

    // No UTM params in the current URL -- a prior persisted value means
    // this is a later page in the same session, not a new landing; no
    // persisted value means this session has no campaign attribution at
    // all. Either way, nothing further happens.
    readPersistedCampaign(storage, storageKey);
    return undefined;
  };
}
