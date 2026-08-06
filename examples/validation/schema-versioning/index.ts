import { createAnalytics, EventValidationError, type AnalyticsProvider, type CanonicalEvent, type DeprecatedEventsMap } from "typetrack";
import { z } from "zod";

// Demonstrates issue 004's `schemaVersion` tag plus the additive-vs-breaking
// schema-evolution discipline from `plan/phase-15-validation-hardening/BRIEF.md`
// Design decision 3: distinguish additive changes (new optional fields --
// safe, no version bump needed) from breaking changes (field rename/removal/
// meaning change -- needs a new event name, never an in-place mutation of
// what an existing field means).
//
// Runnable coverage in this file: the "current version" and "additive
// change" paths (Sections 1-2 below) are both exercised for real, against
// the SAME schema/instance -- proving the additive change requires zero
// call-site changes. The "breaking change, done correctly" path (Section 3)
// is ALSO runnable here (rather than left as a README-only code block),
// since it directly reuses this file's own `makeStubProvider`/scenario
// machinery with no meaningful redundancy against
// `../deprecated-event-rename` -- see README.md's "Design choice" note for
// why, and for the important way this section's breaking change differs
// from that example's pure name-only rename.

// ============================================================================
// v2026.1 -- current, additive-safe schema
// ============================================================================

// As first shipped (schemaVersion "2026.1"): { orderId, total }.
const purchaseCompletedSchemaV1AsShipped = z.object({
  orderId: z.string(),
  total: z.number(),
});

// Later, additively -- STILL "2026.1", no version bump: an optional
// `currency` field was added. Both an old-shaped payload (no `currency`) and
// a new-shaped one (with it) validate against this SAME schema object -- this
// is exactly why an additive change needs no version bump at all: Zod's own
// `.optional()` already covers it, with zero new typetrack API surface.
const purchaseCompletedSchemaCurrent = z.object({
  orderId: z.string(),
  total: z.number(),
  currency: z.string().optional(),
});

export type PurchaseCompletedPayload = z.infer<typeof purchaseCompletedSchemaCurrent>;

const CURRENT_SCHEMA_VERSION = "2026.1";

// ============================================================================
// v2027.1 -- a genuine BREAKING change, done correctly
// ============================================================================
// `total` (dollars, a float) is replaced by `amountCents` (integer cents) --
// a MEANING change to an existing field, not an additive one. Per BRIEF.md's
// discipline, this is done via a genuinely new event name
// ("Purchase Completed V2"), a new schema, a `deprecatedEvents` redirect from
// the old name, and a `schemaVersion` bump -- NEVER by mutating
// `purchaseCompletedSchemaCurrent` in place, which would silently break
// every downstream consumer still expecting `total`.

const purchaseCompletedV2Schema = z.object({
  orderId: z.string(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().optional(),
});

export type PurchaseCompletedV2Payload = z.infer<typeof purchaseCompletedV2Schema>;

const V2_SCHEMA_VERSION = "2027.1";

export const breakingChangeDeprecatedEvents: DeprecatedEventsMap = {
  "Purchase Completed": {
    replacement: "Purchase Completed V2",
    sunsetDate: "2027-06-01",
    message: "total (dollars) was replaced by amountCents (integer cents) -- update call sites to the new payload shape.",
  },
};

// ============================================================================
// Pure logic (unit-tested directly in index.test.ts)
// ============================================================================

export type PurchasePayloadShape = "valid-without-currency" | "valid-with-currency" | "invalid";

// Classifies an arbitrary payload against the CURRENT (2026.1) schema, no
// `createAnalytics()`/provider/I/O involved.
export function classifyPurchasePayload(payload: unknown): PurchasePayloadShape {
  const result = purchaseCompletedSchemaCurrent.safeParse(payload);
  if (!result.success) return "invalid";
  return result.data.currency === undefined ? "valid-without-currency" : "valid-with-currency";
}

// ============================================================================
// Stub provider + scenario wiring
// ============================================================================

export interface CallLogEntry {
  provider: string;
  eventName: string;
  payload: Record<string, unknown>;
  metadata: CanonicalEvent["metadata"];
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
      callLog.push({ provider: name, eventName: event.name, payload: event.properties, metadata: event.metadata });
    },
  };
}

export interface CurrentPurchaseScenario {
  analytics: ReturnType<typeof createAnalytics>;
  callLog: CallLogEntry[];
}

// Section 1-2's instance: the CURRENT (2026.1) schema, covering both the
// original shape and the additive `currency` field, with no version bump
// between the two.
export function createCurrentPurchaseScenario(): CurrentPurchaseScenario {
  const callLog: CallLogEntry[] = [];
  const provider = makeStubProvider("purchase-warehouse", callLog);
  const analytics = createAnalytics({
    provider,
    schemas: { "Purchase Completed": purchaseCompletedSchemaCurrent },
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });
  return { analytics, callLog };
}

export interface V2PurchaseScenario {
  analytics: ReturnType<typeof createAnalytics>;
  callLog: CallLogEntry[];
}

// Section 3's instance: the BREAKING-change-done-correctly setup -- a new
// event name/schema/schemaVersion, plus the `deprecatedEvents` redirect from
// the old name.
export function createV2PurchaseScenario(): V2PurchaseScenario {
  const callLog: CallLogEntry[] = [];
  const provider = makeStubProvider("purchase-warehouse", callLog);
  const analytics = createAnalytics({
    provider,
    schemas: { "Purchase Completed V2": purchaseCompletedV2Schema },
    schemaVersion: V2_SCHEMA_VERSION,
    deprecatedEvents: breakingChangeDeprecatedEvents,
  });
  return { analytics, callLog };
}

if (import.meta.main) {
  console.log(`=== Section 1: current version (schemaVersion "${CURRENT_SCHEMA_VERSION}") ===`);
  const section1 = createCurrentPurchaseScenario();
  const originalShapePayload = { orderId: "ord_1", total: 49.99 };
  console.log(`  classifyPurchasePayload(originalShapePayload): ${classifyPurchasePayload(originalShapePayload)}`);
  console.log(
    `  still validates against the schema exactly as originally shipped, too: ` +
      `${purchaseCompletedSchemaV1AsShipped.safeParse(originalShapePayload).success}`,
  );
  await section1.analytics.track("Purchase Completed", originalShapePayload);
  console.log(`  tracked "Purchase Completed" with ${JSON.stringify(originalShapePayload)}`);
  console.log(`  metadata stamped on the delivered event: ${JSON.stringify(section1.callLog[0]!.metadata)}`);

  console.log();
  console.log(`=== Section 2: additive change (still "${CURRENT_SCHEMA_VERSION}" -- no version bump) ===`);
  const additiveShapePayload = { orderId: "ord_2", total: 79.5, currency: "USD" };
  console.log(`  classifyPurchasePayload(additiveShapePayload): ${classifyPurchasePayload(additiveShapePayload)}`);
  await section1.analytics.track("Purchase Completed", additiveShapePayload);
  console.log(`  tracked "Purchase Completed" with ${JSON.stringify(additiveShapePayload)}`);
  console.log(
    `  same schema, same schemaVersion ("${CURRENT_SCHEMA_VERSION}") -- both the original shape and the additive ` +
      "shape validated against the SAME schema, with zero call-site changes for pre-existing callers.",
  );
  console.log(`  provider received ${section1.callLog.length} event(s) total, both under schemaVersion "${CURRENT_SCHEMA_VERSION}"`);

  console.log();
  console.log(`=== Section 3: a genuine breaking change, done correctly (V2, schemaVersion "${V2_SCHEMA_VERSION}") ===`);
  const section3 = createV2PurchaseScenario();

  // An OLD call site, unmodified, still calling the old event name.
  // `deprecatedEvents` transparently redirects the EVENT NAME to
  // "Purchase Completed V2" -- but the V2 schema expects `amountCents`, not
  // `total`, so this old-shaped PAYLOAD still fails validation. This is the
  // key difference from `../deprecated-event-rename`'s pure name-only
  // migration: a field-level breaking change still requires updating the
  // call site's payload, even though the event NAME itself redirects for
  // free.
  try {
    await section3.analytics.track("Purchase Completed", { orderId: "ord_3", total: 99.0 });
    console.log("  unexpectedly succeeded (this should not happen)");
  } catch (error) {
    if (error instanceof EventValidationError) {
      console.log(
        `  old-shaped payload via the old event name "Purchase Completed" -> threw EventValidationError ` +
          `(name redirected to "${error.event}", but the payload shape was never updated): ${error.message}`,
      );
    } else {
      throw error;
    }
  }

  // The UPDATED call site: new payload shape, tracked under the new event
  // name directly.
  const v2Payload = { orderId: "ord_3", amountCents: 9900, currency: "USD" };
  await section3.analytics.track("Purchase Completed V2", v2Payload);
  console.log(`  updated call site tracked "Purchase Completed V2" with ${JSON.stringify(v2Payload)} -> validated`);
  console.log(`  metadata stamped on the delivered event: ${JSON.stringify(section3.callLog[0]!.metadata)}`);
  console.log(
    `  provider received ${section3.callLog.length} event(s) total (the failed validation above never reached the provider)`,
  );
}
