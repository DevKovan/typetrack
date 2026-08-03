// Phase 9's context-capture vocabulary: runtime detection, a small
// hand-rolled UA parser, and the static-vs-dynamic split of "what does
// typetrack know about the environment an event happened in". Depends on
// nothing from `./schema`/`./index.ts`; not consumed by `createAnalytics()`
// yet -- this module is purely additive and pure-functional until issue 002
// wires it into construction (`captureStaticContext`, once, cached) and
// `buildEvent()` (`captureDynamicContext`, once per `track`/`page`/`screen`
// call).
//
// Zero vendor deps (per CLAUDE.md's "zero vendor deps in core" rule) -- no
// `ua-parser-js` or similar. UA parsing below is a small, best-effort,
// regex-based heuristic, not exhaustive.
//
// This package's root `tsconfig.json` deliberately has no `"dom"` in `lib`
// (core ships with zero DOM/browser-API surface in its own type-checking),
// so `window`/`navigator`/`document`/`location` aren't ambient types here.
// The handful of browser globals this module reads are typed with minimal
// ad-hoc shapes and accessed off `globalThis` (equivalent at runtime to a
// bare `window`/`navigator` reference, since global `var`-style bindings are
// themselves properties of `globalThis`) -- this also happens to be exactly
// the shape a test needs to stub via `Object.defineProperty(globalThis, ...)`
// without any DOM test-environment dependency.
interface MinimalNavigator {
  language?: string;
  userAgent?: string;
}

interface MinimalLocation {
  search?: string;
}

interface MinimalDocument {
  referrer?: string;
}

interface MinimalWindow {
  innerWidth?: number;
  innerHeight?: number;
}

interface MinimalBrowserGlobal {
  window?: MinimalWindow;
  navigator?: MinimalNavigator;
  document?: MinimalDocument;
  location?: MinimalLocation;
}

function browserGlobal(): MinimalBrowserGlobal {
  return globalThis as unknown as MinimalBrowserGlobal;
}

export interface CapturedContext {
  locale?: string;
  timezone?: string;
  browser?: { name: string; version?: string };
  os?: { name: string; version?: string };
  device?: { type: "desktop" | "mobile" | "tablet" };
  viewport?: { width: number; height: number };
  referrer?: string;
  campaign?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  featureFlags?: Record<string, unknown>;
}

// The public opt-in shape supplied to `createAnalytics({ context })` (issue
// 002 owns wiring this into `CreateAnalyticsOptions`; this issue only
// defines the type since `captureDynamicContext` takes it as a param).
export interface ContextOptions {
  autoCapture?: boolean;
  featureFlags?: () => Record<string, unknown>;
}

// Feature detection, not UA sniffing: both globals present is treated as "a
// browser-like environment" regardless of what actually put them there (real
// browser, a DOM test environment, etc).
export function isBrowserEnvironment(): boolean {
  const g = browserGlobal();
  return typeof g.window !== "undefined" && typeof g.navigator !== "undefined";
}

type CampaignParams = NonNullable<CapturedContext["campaign"]>;

// Order matters throughout this module's regex checks: several real UA
// strings contain more than one browser/OS token (e.g. Chromium-based Edge
// contains both "Edg/" and "Chrome/"; Chrome's own UA contains "Safari/"),
// so more specific/newer tokens are checked before the broader ones they'd
// otherwise be mistaken for.
function parseBrowser(ua: string): { name: string; version?: string } | undefined {
  let match = ua.match(/Edg\/([\d.]+)/);
  if (match) {
    return { name: "Edge", version: match[1] };
  }

  match = ua.match(/Chrome\/([\d.]+)/);
  if (match) {
    return { name: "Chrome", version: match[1] };
  }

  match = ua.match(/Firefox\/([\d.]+)/);
  if (match) {
    return { name: "Firefox", version: match[1] };
  }

  if (/Safari\//.test(ua)) {
    // Safari's own version is carried in "Version/x.y", not the WebKit build
    // number in "Safari/605.1.15" -- if "Version/" is missing for some
    // reason, still report the browser name, just without a version.
    match = ua.match(/Version\/([\d.]+)/);
    return match ? { name: "Safari", version: match[1] } : { name: "Safari" };
  }

  return undefined;
}

function parseOs(ua: string): { name: string; version?: string } | undefined {
  let match = ua.match(/Windows NT ([\d.]+)/);
  if (match) {
    return { name: "Windows", version: match[1] };
  }

  // iPhone/iPad UAs use "iPhone OS x_y" or (iPad) "CPU OS x_y" -- checked
  // before the generic "Mac OS X" pattern below, since both mention "Mac OS
  // X" in the surrounding "like Mac OS X" text but that text has no trailing
  // version digits, so it wouldn't match the macOS regex anyway; checking
  // order here is a belt-and-suspenders precaution, not load-bearing.
  match = ua.match(/iPhone OS ([\d_]+)/) ?? ua.match(/CPU OS ([\d_]+)/);
  if (match) {
    return { name: "iOS", version: (match[1] ?? "").replace(/_/g, ".") };
  }

  // Android UAs also contain "Linux;" -- checked before the generic Linux
  // fallback below.
  match = ua.match(/Android ([\d.]+)/);
  if (match) {
    return { name: "Android", version: match[1] };
  }

  match = ua.match(/Mac OS X ([\d_.]+)/);
  if (match) {
    return { name: "macOS", version: (match[1] ?? "").replace(/_/g, ".") };
  }

  if (/Linux/.test(ua)) {
    // No reliably-parseable version number in a generic desktop-Linux UA
    // (e.g. "X11; Linux x86_64") -- name only.
    return { name: "Linux" };
  }

  return undefined;
}

function parseDeviceType(ua: string): "desktop" | "mobile" | "tablet" {
  if (/iPad/.test(ua) || /Tablet/.test(ua)) {
    return "tablet";
  }
  if (/Mobi/.test(ua)) {
    // "Mobi" matches both "Mobile" and the standalone "Mobi" token some UAs
    // use.
    return "mobile";
  }
  if (/Android/.test(ua) && !/Mobile/.test(ua)) {
    // Android tablets conventionally omit the "Mobile" token that Android
    // phones include.
    return "tablet";
  }
  return "desktop";
}

// Best-effort, hand-rolled, regex-based. Never throws. Returns an object
// with only the sub-fields it could confidently parse -- an unrecognized UA
// string returns `{}` (all three sub-fields omitted), not a thrown error and
// not guessed defaults.
export function parseUserAgent(userAgent: string): {
  browser?: { name: string; version?: string };
  os?: { name: string; version?: string };
  device?: { type: "desktop" | "mobile" | "tablet" };
} {
  try {
    const ua = typeof userAgent === "string" ? userAgent : "";
    const browser = parseBrowser(ua);
    const os = parseOs(ua);

    // `device.type` falls back to `"desktop"` only when the UA was otherwise
    // recognized (browser and/or OS matched something) -- a wholly
    // unrecognized/garbage/empty string returns `{}` entirely rather than
    // guessing "desktop" for input that isn't even a real UA string.
    if (!browser && !os) {
      return {};
    }

    return {
      ...(browser && { browser }),
      ...(os && { os }),
      device: { type: parseDeviceType(ua) },
    };
  } catch {
    return {};
  }
}

// Captured once, meant to be called exactly once at `createAnalytics()`
// construction time and cached by the caller. Populates `locale`/`timezone`
// unconditionally (via `Intl`); populates `browser`/`os`/`device` only in a
// browser environment (delegates to `parseUserAgent(navigator.userAgent)`).
export function captureStaticContext(): Pick<
  CapturedContext,
  "locale" | "timezone" | "browser" | "os" | "device"
> {
  const result: Pick<CapturedContext, "locale" | "timezone" | "browser" | "os" | "device"> = {};

  try {
    const inBrowser = isBrowserEnvironment();
    const navigatorLanguage = inBrowser ? browserGlobal().navigator?.language : undefined;

    // Prefer `navigator.language` in a browser environment (more accurate
    // for the user's actual browser-language preference); fall back to
    // `Intl` everywhere else, including a browser without `navigator.language`
    // for some reason.
    result.locale = navigatorLanguage || Intl.DateTimeFormat().resolvedOptions().locale;
    result.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (inBrowser) {
      const userAgent = browserGlobal().navigator?.userAgent ?? "";
      const parsed = parseUserAgent(userAgent);
      if (parsed.browser) {
        result.browser = parsed.browser;
      }
      if (parsed.os) {
        result.os = parsed.os;
      }
      if (parsed.device) {
        result.device = parsed.device;
      }
    }
  } catch {
    // Never throw -- return whatever was captured before the failure (may be
    // an empty object in a pathological environment where even `Intl`
    // throws).
  }

  return result;
}

const UTM_PARAM_TO_CAMPAIGN_KEY: Record<string, keyof CampaignParams> = {
  utm_source: "source",
  utm_medium: "medium",
  utm_campaign: "campaign",
  utm_term: "term",
  utm_content: "content",
};

// Parses the standard five UTM query params out of a `location.search`-style
// string. A param absent from the URL is simply absent from the returned
// object (not `undefined`); if none of the five are present, returns
// `undefined` (the caller omits `campaign` entirely rather than including an
// empty object).
function parseCampaign(search: string): CampaignParams | undefined {
  const params = new URLSearchParams(search);
  const campaign: CampaignParams = {};
  let matchedAny = false;

  for (const [param, key] of Object.entries(UTM_PARAM_TO_CAMPAIGN_KEY)) {
    const value = params.get(param);
    if (value !== null) {
      campaign[key] = value;
      matchedAny = true;
    }
  }

  return matchedAny ? campaign : undefined;
}

// Called fresh on every `track`/`page`/`screen` invocation. `viewport`/
// `referrer`/`campaign` are populated only in a browser environment (read
// live from `window`/`document`/`location` at call time -- e.g. survives SPA
// navigation/resize between calls, unlike the static fields). `featureFlags`
// invokes `contextOptions?.featureFlags?.()` fresh every call
// (browser-environment-independent -- a Node-side app can supply a flag
// getter too) and mirrors its return value verbatim; omitted entirely if no
// getter was supplied (or if the getter throws -- this module never throws).
export function captureDynamicContext(
  contextOptions: ContextOptions | undefined,
): Pick<CapturedContext, "viewport" | "referrer" | "campaign" | "featureFlags"> {
  const result: Pick<CapturedContext, "viewport" | "referrer" | "campaign" | "featureFlags"> = {};

  try {
    if (isBrowserEnvironment()) {
      const g = browserGlobal();

      const width = g.window?.innerWidth;
      const height = g.window?.innerHeight;
      if (typeof width === "number" && typeof height === "number") {
        result.viewport = { width, height };
      }

      const referrer = g.document?.referrer;
      if (typeof referrer === "string" && referrer !== "") {
        result.referrer = referrer;
      }

      const campaign = parseCampaign(g.location?.search ?? "");
      if (campaign) {
        result.campaign = campaign;
      }
    }
  } catch {
    // Never throw -- leave viewport/referrer/campaign omitted on failure.
  }

  try {
    if (contextOptions?.featureFlags) {
      result.featureFlags = contextOptions.featureFlags();
    }
  } catch {
    // Never throw -- an app-supplied getter that throws simply results in
    // `featureFlags` being omitted for this call.
  }

  return result;
}
