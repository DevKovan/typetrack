import {
  autoClicks,
  autoPage,
  autoScroll,
  autoUTM,
  autoVisibility,
  createAnalytics,
  type AnalyticsProvider,
} from "typetrack";

// A realistic marketing-landing-page scenario composing the 5 Phase 10
// plugins concerned with page/session/interaction tracking (as opposed to
// raw browser telemetry -- see `../site-reliability-and-vitals` for that
// half): `autoPage()`, `autoUTM()`, `autoClicks()`, `autoScroll()`,
// `autoVisibility()`. Every log line below (`sink`) is produced by an
// actual `typetrack` run -- nothing here is a hand-authored transcript --
// so `index.integration.test.ts` can assert against it directly and
// `expected-output.txt` is a literal capture of `bun run index.ts`'s
// stdout.
//
// None of `window`/`navigator`/`document`/`location`/`history`/
// `sessionStorage` exist in a plain Bun script, so this file simulates a
// "real page" by stubbing those globals directly on `globalThis` before
// calling into `typetrack` -- the exact technique established by
// `src/context.test.ts` (Phase 9) and reused by every Phase 10 plugin's own
// integration test (`src/plugins/autoPage.integration.test.ts`,
// `src/plugins/domInteraction.integration.test.ts`,
// `src/plugins/autoUTM.integration.test.ts`).

export interface CallLogEntry {
  verb: "page" | "track";
  name: string;
  properties: Record<string, unknown>;
}

// Renders one provider-received call into a human-readable line, pushes it
// into `sink` (for assertions), and mirrors it to `console.log` (so
// `bun run index.ts`'s stdout matches `sink` exactly, line for line) --
// mirrors `examples/middleware/pipeline-basics/index.ts`'s `makeLog`.
function makeLog(sink: string[]): (message: string) => void {
  return (message) => {
    sink.push(message);
    console.log(message);
  };
}

// A hand-written stub provider standing in for a real analytics warehouse.
// Records every `.page()`/`.track()` call it receives, both structurally
// (`callLog`, for assertions) and as a human-readable narrative line
// (`sink`/console).
export function createLandingPageWarehouseProvider(callLog: CallLogEntry[], sink: string[]): AnalyticsProvider {
  const log = makeLog(sink);

  return {
    name: "landing-page-warehouse",
    capabilities: {
      identify: false,
      group: false,
      alias: false,
      page: true,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      callLog.push({ verb: "track", name: event.name, properties: event.properties });
      log(`[provider] landing-page-warehouse received track("${event.name}") ${JSON.stringify(event.properties)}`);
    },
    page(event) {
      callLog.push({ verb: "page", name: event.name, properties: event.properties });
      log(`[provider] landing-page-warehouse received page("${event.name}") ${JSON.stringify(event.properties)}`);
    },
  };
}

// A minimal, duck-typed stand-in for a clicked DOM element -- exactly the
// shape `autoClicks()`'s `computeClickProperties`/`closest()` scoping reads
// (`tagName`/`id`/`className`/`textContent`/`href`), plus a small
// `attributes` bag this example's own `elementMatchesSelector` reads for
// `[data-cta]`-style attribute selectors (a real DOM `Element` supports
// this via `hasAttribute`/`getAttribute`; this stub models it as a plain
// object since `typetrack`'s public API only re-exports `AutoClicksOptions`,
// not the internal `MinimalElement` shape -- this is a from-scratch,
// self-contained duck type, not an import of it).
export interface StubElement {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  href?: string;
  attributes?: Record<string, string>;
  closest?: (selector: string) => StubElement | null;
}

// Supports the three CSS selector shapes this example's simulated clicks
// need to match against: a bare tag name (e.g. "a"), a leading-dot class
// selector (e.g. ".btn"), and a bracketed attribute-presence selector (e.g.
// "[data-cta]", used to scope `autoClicks({ selector: "[data-cta]" })` to
// only the call-to-action element below) -- pure, exported for direct unit
// testing without going through a simulated click event.
export function elementMatchesSelector(element: StubElement, selector: string): boolean {
  if (selector.startsWith(".")) {
    return (element.className ?? "").split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const attribute = selector.slice(1, -1);
    return Object.prototype.hasOwnProperty.call(element.attributes ?? {}, attribute);
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

// Wires `element.closest(selector)` to walk `[element, ...ancestors]`
// (innermost first, exactly how a real DOM ancestor chain is walked),
// returning the first match found via `elementMatchesSelector` above (or
// `null`, mirroring the real `Element.closest` contract) -- this is what
// lets a click on a *nested* element (e.g. an icon inside the CTA button)
// still resolve to the CTA button itself once `autoClicks({ selector:
// "[data-cta]" })` scopes the click.
function withClosest(element: StubElement, ancestors: StubElement[] = []): StubElement {
  const chain = [element, ...ancestors];
  element.closest = (selector) => chain.find((candidate) => elementMatchesSelector(candidate, selector)) ?? null;
  return element;
}

type Listener = (...args: unknown[]) => void;

export interface StubbedLandingPageBrowser {
  navigateTo: (pathname: string, search?: string) => void;
  pushState: (pathname: string, search?: string) => void;
  fireClick: (target: StubElement) => void;
  setScrollState: (state: { scrollY: number; innerHeight: number; scrollHeight: number }) => void;
  fireScroll: () => void;
  setVisibilityState: (state: string) => void;
  fireVisibilityChange: () => void;
  sessionStorageData: Record<string, string>;
}

// `navigator`/`addEventListener`/`removeEventListener` are real Bun
// builtins already present on `globalThis` (unlike `window`/`document`/
// `location`/`history`/`sessionStorage`/`scrollY`/`innerHeight`, genuinely
// absent from Bun's global scope by default) -- naively `delete`-ing them
// in `clearStubBrowser()` would permanently remove the real ones for the
// rest of this `bun test` process (all files share one process), breaking
// unrelated later test files (e.g. `happy-dom`'s `BrowserWindow`
// construction reads a bare `performance`/`navigator` reference). This
// module instead snapshots each key's original property descriptor (if
// any) before first stubbing it, and restores that exact descriptor (or
// deletes the key, if it had none) in `clearStubBrowser()` -- safe for both
// real builtins and genuinely-absent keys. Mirrors
// `src/plugins/telemetry.integration.test.ts`'s `stubGlobal`/
// `clearBrowserGlobals` convention exactly.
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown): void {
  if (!originalDescriptors.has(key)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

// Stubs `window`/`navigator`/`location`/`history`/`document`/top-level
// `addEventListener`/`removeEventListener`/`scrollY`/`innerHeight`/
// `sessionStorage` as top-level `globalThis` properties -- matching
// `src/context.test.ts`'s convention, and every Phase 10 plugin's own reads
// off `globalThis` directly (not nested under a `window` object). `history
// .pushState`/`replaceState` are genuinely mutable function properties on a
// plain object (not patched here) -- `autoPage()` itself patches them at
// plugin-setup time, exactly as it would a real `window.history`.
function installStubBrowser(initialPathname: string, initialSearch: string): StubbedLandingPageBrowser {
  const documentListeners = new Map<string, Set<Listener>>();
  const windowListeners = new Map<string, Set<Listener>>();
  const location = { pathname: initialPathname, search: initialSearch };
  const sessionStorageData: Record<string, string> = {};

  const documentElement = { scrollHeight: 0 };
  const documentStub = {
    visibilityState: "visible",
    documentElement,
    addEventListener(type: string, listener: Listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      documentListeners.get(type)?.delete(listener);
    },
  };

  const history = {
    pushState(..._args: unknown[]): unknown {
      return undefined;
    },
    replaceState(..._args: unknown[]): unknown {
      return undefined;
    },
  };

  const sessionStorageStub = {
    getItem(key: string): string | null {
      return key in sessionStorageData ? sessionStorageData[key]! : null;
    },
    setItem(key: string, value: string): void {
      sessionStorageData[key] = value;
    },
  };

  stubGlobal("window", {});
  stubGlobal("navigator", {});
  stubGlobal("location", location);
  stubGlobal("history", history);
  stubGlobal("document", documentStub);
  stubGlobal("sessionStorage", sessionStorageStub);
  stubGlobal("scrollY", 0);
  stubGlobal("innerHeight", 0);
  stubGlobal("addEventListener", (type: string, listener: Listener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(listener);
  });
  stubGlobal("removeEventListener", (type: string, listener: Listener) => {
    windowListeners.get(type)?.delete(listener);
  });

  return {
    navigateTo(pathname, search = "") {
      location.pathname = pathname;
      location.search = search;
    },
    pushState(pathname, search = "") {
      location.pathname = pathname;
      location.search = search;
      // `history.pushState` is reassigned in place by `autoPage()`'s setup
      // (see `src/plugins/autoPage.ts`) -- calling it here, rather than
      // firing a synthetic event, exercises that exact patched function,
      // the same way a real client-side router would.
      history.pushState({}, "", pathname);
    },
    fireClick(target) {
      for (const listener of documentListeners.get("click") ?? []) listener({ target });
    },
    setScrollState({ scrollY, innerHeight, scrollHeight }) {
      stubGlobal("scrollY", scrollY);
      stubGlobal("innerHeight", innerHeight);
      documentElement.scrollHeight = scrollHeight;
    },
    fireScroll() {
      for (const listener of windowListeners.get("scroll") ?? []) listener();
    },
    setVisibilityState(state) {
      documentStub.visibilityState = state;
    },
    fireVisibilityChange() {
      for (const listener of documentListeners.get("visibilitychange") ?? []) listener();
    },
    sessionStorageData,
  };
}

// Restores each stubbed key's pre-stub descriptor (the real Bun builtins
// for `navigator`/`addEventListener`/`removeEventListener`), or deletes it
// if it had none (`window`/`location`/`history`/`document`/
// `sessionStorage`/`scrollY`/`innerHeight`, genuinely absent from Bun's
// global scope) -- see `stubGlobal`'s comment above for why this matters.
function clearStubBrowser(): void {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  originalDescriptors.clear();
}

export interface LandingPageEngagementResult {
  // Every log line produced across the whole flow, in the exact order
  // `bun run index.ts` prints them -- this is what `expected-output.txt`
  // captures verbatim.
  sink: string[];
  // What the provider actually received, in call order.
  callLog: CallLogEntry[];
  sessionStorageData: Record<string, string>;
}

// The example's real entry point: a visitor's full landing-page session,
// walked scenario by scenario. Exported (rather than only run inline) so
// `index.integration.test.ts` runs this exact function.
export async function runLandingPageEngagementFlow(): Promise<LandingPageEngagementResult> {
  const sink: string[] = [];
  const callLog: CallLogEntry[] = [];
  const log = makeLog(sink);

  console.log('=== Step 1: arriving via a campaign link ("/landing?utm_source=...") ===');
  const browser = installStubBrowser(
    "/landing",
    "?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale",
  );
  const provider = createLandingPageWarehouseProvider(callLog, sink);

  const analytics = createAnalytics({
    provider,
    plugins: [autoPage(), autoUTM(), autoClicks({ selector: "[data-cta]" }), autoScroll({ thresholds: [25, 50, 100] }), autoVisibility()],
  });

  console.log("\n=== Step 2: initial autoPage() page view and autoUTM() landing event already fired at setup ===");
  log(`[flow] setup produced ${callLog.length} provider call(s) so far`);

  console.log('\n=== Step 3: a visitor clicks the CTA (matches "[data-cta]"), then a non-matching link (ignored) ===');
  const ctaButton = withClosest({
    tagName: "A",
    className: "btn btn-primary",
    textContent: "Start Free Trial",
    href: "/signup",
    attributes: { "data-cta": "true" },
  });
  const ctaIcon = withClosest({ tagName: "SPAN", textContent: "→" }, [ctaButton]);
  const secondaryLink = withClosest({ tagName: "A", className: "nav-link", textContent: "Learn More", href: "/learn-more" });

  browser.fireClick(ctaIcon); // nested inside the CTA -- resolved via closest().
  browser.fireClick(secondaryLink); // does not match "[data-cta]" -- ignored.

  console.log("\n=== Step 4: the visitor scrolls past the 25%/50%/100% thresholds ===");
  browser.setScrollState({ scrollY: 200, innerHeight: 100, scrollHeight: 1200 }); // 25%
  browser.fireScroll();
  browser.setScrollState({ scrollY: 500, innerHeight: 100, scrollHeight: 1200 }); // 50%
  browser.fireScroll();
  browser.setScrollState({ scrollY: 1100, innerHeight: 100, scrollHeight: 1200 }); // 100%
  browser.fireScroll();

  console.log("\n=== Step 5: the visitor switches tabs (visibilitychange -> hidden) ===");
  browser.setVisibilityState("hidden");
  browser.fireVisibilityChange();

  console.log('\n=== Step 6: a client-side navigation to "/pricing" (no UTM params) ===');
  browser.pushState("/pricing", "");

  console.log("\n=== Step 7: analytics.destroy() -- further scroll/click/pushState produce no further events ===");
  const callCountBeforeDestroy = callLog.length;
  await analytics.destroy();

  browser.fireClick(ctaIcon);
  browser.setScrollState({ scrollY: 1200, innerHeight: 100, scrollHeight: 1200 });
  browser.fireScroll();
  browser.pushState("/after-destroy", "");

  log(
    `[flow] ${callLog.length - callCountBeforeDestroy} provider call(s) after destroy() (expected: 0, was ${callCountBeforeDestroy} before)`,
  );

  const sessionStorageData = { ...browser.sessionStorageData };
  clearStubBrowser();

  return { sink, callLog, sessionStorageData };
}

// Only runs when this file is executed directly (`bun run index.ts`), not
// when imported by the test files.
if (import.meta.main) {
  await runLandingPageEngagementFlow();
}
