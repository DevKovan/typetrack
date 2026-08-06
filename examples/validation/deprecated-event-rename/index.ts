import { createAnalytics, type AnalyticsProvider, type DeprecatedEventsMap } from "typetrack";

// A realistic tracking-plan migration: an app originally shipped
// `"checkout_started"` (snake_case, an early convention), and is migrating
// its whole tracking plan to Title Case event names (`"Checkout Started"`).
// `deprecatedEvents` (issues 001/002) makes this a ONE CONFIG FILE change,
// not an application-code sweep -- every existing
// `analytics.track("checkout_started", ...)` call site across the codebase
// keeps compiling and keeps working unmodified, while the event that
// actually reaches providers (and gets schema-validated, if a schema exists)
// is the new, renamed one. This is directly the same "Prisma for Analytics"
// vendor-abstraction ethos (`plan/VISION.md`'s Golden Rule) applied to event
// *naming* instead of *provider* choice: a `deprecatedEvents` entry is a
// one-file rename migration, the same shape as a one-file provider swap.

export const deprecatedEventsConfig: DeprecatedEventsMap = {
  checkout_started: {
    replacement: "Checkout Started",
    sunsetDate: "2027-01-01",
  },
};

export interface CallSiteMigrationStatus {
  eventName: string;
  isDeprecated: boolean;
  // The name the event actually fires under, once resolved against
  // `deprecatedEventsConfig` -- equals `eventName` itself when there's no
  // entry, or an entry with no `replacement`.
  firesAs: string;
}

// Pure, no I/O: describes what will happen to a given event name under this
// example's `deprecatedEventsConfig`, without constructing an `Analytics`
// instance at all. Unit-tested directly in `index.test.ts`.
export function describeCallSiteMigration(eventName: string, config: DeprecatedEventsMap): CallSiteMigrationStatus {
  const entry = config[eventName];
  return {
    eventName,
    isDeprecated: entry !== undefined,
    firesAs: entry?.replacement ?? eventName,
  };
}

export interface CallLogEntry {
  provider: string;
  eventName: string;
  payload: Record<string, unknown>;
}

function makeStubProvider(name: string, callLog: CallLogEntry[]): AnalyticsProvider {
  return {
    name,
    capabilities: {
      identify: false,
      group: false,
      alias: false,
      page: false,
      screen: false,
      batching: false,
      offline: false,
      featureFlags: false,
      sessionReplay: false,
      heatmaps: false,
    },
    track(event) {
      callLog.push({ provider: name, eventName: event.name, payload: event.properties });
    },
  };
}

export interface CheckoutMigrationScenario {
  analytics: ReturnType<typeof createAnalytics>;
  callLog: CallLogEntry[];
}

// Builds one fresh scenario: a single stub provider (`checkout-warehouse`)
// wired behind `createAnalytics({ deprecatedEvents: deprecatedEventsConfig })`
// -- the one-file config change this whole example demonstrates.
export function createCheckoutMigrationScenario(): CheckoutMigrationScenario {
  const callLog: CallLogEntry[] = [];
  const provider = makeStubProvider("checkout-warehouse", callLog);
  const analytics = createAnalytics({ provider, deprecatedEvents: deprecatedEventsConfig });
  return { analytics, callLog };
}

// The OLD call site -- written before the tracking-plan rename, and never
// touched since. Standing in for application code scattered across a real
// codebase (checkout page, cart abandonment email trigger, etc.) that nobody
// wants to go find and edit just because the tracking plan renamed one event.
export async function trackLegacyCheckoutStart(
  analytics: ReturnType<typeof createAnalytics>,
  cartValue: number,
): Promise<void> {
  await analytics.track("checkout_started", { cartValue });
}

export interface MigrationDemoResult {
  callLog: CallLogEntry[];
  // How many times `console.warn` actually fired across all 3 old-call-site
  // invocations below -- expected to be exactly 1 (warn-once-per-event-name,
  // for the entire lifetime of one `Analytics` instance), even though the
  // old call site was invoked 3 times.
  warnCount: number;
}

// Runs the old call site 3 times through one fresh scenario, counting real
// `console.warn` invocations (without swallowing them -- the wrapper below
// still forwards every call to the original `console.warn`, so the warning
// text is still visible in this run's own stderr output) so both
// `bun run index.ts` and `index.integration.test.ts` can assert on the exact
// count deterministically.
export async function runCheckoutMigrationDemo(): Promise<MigrationDemoResult> {
  const { analytics, callLog } = createCheckoutMigrationScenario();

  let warnCount = 0;
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: Parameters<typeof console.warn>) => {
    warnCount++;
    originalWarn(...args);
  };

  try {
    await trackLegacyCheckoutStart(analytics, 42);
    await trackLegacyCheckoutStart(analytics, 89);
    await trackLegacyCheckoutStart(analytics, 15);
  } finally {
    console.warn = originalWarn;
  }

  return { callLog, warnCount };
}

if (import.meta.main) {
  console.log('Old call site (unmodified): analytics.track("checkout_started", { cartValue })');
  console.log(`deprecatedEvents config: ${JSON.stringify(deprecatedEventsConfig)}`);
  console.log();

  const migrationStatus = describeCallSiteMigration("checkout_started", deprecatedEventsConfig);
  console.log(`Migration status for "checkout_started": ${JSON.stringify(migrationStatus)}`);
  console.log();

  console.log("Calling the old call site 3 times, through the same Analytics instance...");
  const { callLog, warnCount } = await runCheckoutMigrationDemo();

  console.log();
  console.log(`console.warn fired ${warnCount} time(s) across 3 calls (expected 1 -- warn-once-per-event-name)`);
  console.log(`Provider received ${callLog.length} event(s):`);
  for (const entry of callLog) {
    console.log(`  ${entry.provider} received track("${entry.eventName}") ${JSON.stringify(entry.payload)}`);
  }
}
