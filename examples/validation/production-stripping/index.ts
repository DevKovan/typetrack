import { createAnalytics, EventValidationError, type AnalyticsProvider, type InferEvents } from "typetrack";
import { z } from "zod";

// Demonstrates issue 003's `validate` option (`CreateAnalyticsOptions.validate`)
// wired to a simulated bundler env check, standing in for what a real app's
// bundler (Vite/webpack/esbuild) would statically replace and dead-code
// eliminate at build time. `IS_PRODUCTION` below is written exactly the way
// a real app would write it -- core itself never reads `NODE_ENV` (see
// `validate`'s own doc comment in `src/index.ts`).
//
// This file's runnable demo below deliberately constructs TWO explicit
// `createAnalytics()` instances (one `validate: true`, one `validate: false`)
// side by side, rather than branching a single instance on `IS_PRODUCTION` at
// runtime -- so both behaviors are directly observable in one run,
// regardless of what `NODE_ENV` happens to be set to when `bun run index.ts`
// is actually invoked. See README.md's "Production notes" for the real-world
// recipe (`validate: !IS_PRODUCTION`) and, critically, why `validate: false`
// alone does NOT shrink a production bundle.

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

// A realistic event: an order placed on a checkout page. `amount` must be a
// positive number -- a payload with the wrong types (e.g. from an untyped
// upstream source, like a third-party webhook) is exactly what runtime
// validation exists to catch, even in a codebase that otherwise has full
// TypeScript coverage.
const eventSchemas = {
  "Order Placed": z.object({
    orderId: z.string(),
    amount: z.number().positive(),
  }),
} satisfies Record<string, z.ZodType>;

export type Events = InferEvents<typeof eventSchemas>;

// A payload that is malformed relative to `eventSchemas["Order Placed"]`:
// `orderId` is a number instead of a string, and `amount` is a non-numeric
// string. Cast through `unknown` when tracking it below -- simulating a
// payload that arrived from an untyped source (JSON.parse of an external
// system, a legacy call site, etc.), which is exactly the situation runtime
// validation is meant to guard against even in a fully-typed app.
export const MALFORMED_ORDER_PAYLOAD: unknown = { orderId: 42, amount: "nine hundred" };

export interface CallLogEntry {
  provider: string;
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
      callLog.push({ provider: name, payload: event.properties });
    },
  };
}

// The runtime-check-only instance: `validate: true` (issue 003's own
// default, so this is identical to omitting `validate` entirely) --
// `schema.safeParse()` still runs on every `track()` call.
export function createValidatingAnalytics(provider: AnalyticsProvider) {
  return createAnalytics<Events>({ provider, schemas: eventSchemas, validate: true });
}

// The "runtime check skipped" instance: `validate: false` -- `track()`
// forwards `payload` exactly as given, with no `schema.safeParse()` call at
// all (identical to an event with no `schemas[event]` entry).
export function createNonValidatingAnalytics(provider: AnalyticsProvider) {
  return createAnalytics<Events>({ provider, schemas: eventSchemas, validate: false });
}

export interface ValidationConfig {
  schemas: typeof eventSchemas | undefined;
  validate: boolean;
}

// The pure decision this recipe is built on -- extracted on its own so it's
// directly unit-testable with no `createAnalytics()`/provider/I/O involved
// at all (see `index.test.ts`). Guards BOTH `validate` AND the `schemas`
// reference itself behind the same `isProduction` check. Guarding `validate`
// alone (as `createValidatingAnalytics`/`createNonValidatingAnalytics` show
// above) only skips the runtime check -- it does nothing to the bundle size,
// because `eventSchemas` (and the Zod runtime it pulls in) is still
// referenced, and therefore still bundled, either way. Guarding the
// `schemas` reference too gives the *app's own* bundler's dead-code
// elimination something statically-`false`-guarded to actually remove -- see
// README.md's "Production notes" (a)/(b).
export function resolveValidationConfig(isProduction: boolean): ValidationConfig {
  return {
    schemas: isProduction ? undefined : eventSchemas,
    validate: !isProduction,
  };
}

// Recipe function for real bundle-size stripping: wires `resolveValidationConfig`'s
// decision straight into `createAnalytics()`.
export function createGuardedAnalytics(provider: AnalyticsProvider) {
  const { schemas, validate } = resolveValidationConfig(IS_PRODUCTION);
  return createAnalytics<Events>({ provider, schemas, validate });
}

if (import.meta.main) {
  console.log(`IS_PRODUCTION (process.env.NODE_ENV === "production"): ${IS_PRODUCTION}`);
  console.log(`Malformed payload: ${JSON.stringify(MALFORMED_ORDER_PAYLOAD)}`);
  console.log();

  console.log('=== Instance A: validate: true (the default -- runtime check stays on) ===');
  const callLogA: CallLogEntry[] = [];
  const analyticsA = createValidatingAnalytics(makeStubProvider("order-warehouse", callLogA));
  try {
    await analyticsA.track("Order Placed", MALFORMED_ORDER_PAYLOAD as Events["Order Placed"]);
    console.log("  unexpectedly succeeded (this should not happen)");
  } catch (error) {
    if (error instanceof EventValidationError) {
      console.log(`  threw EventValidationError: ${error.message}`);
    } else {
      throw error;
    }
  }
  console.log(`  provider call count: ${callLogA.length} (expected 0 -- the provider is never reached on a validation failure)`);

  console.log();
  console.log('=== Instance B: validate: false (the runtime check is skipped) ===');
  const callLogB: CallLogEntry[] = [];
  const analyticsB = createNonValidatingAnalytics(makeStubProvider("order-warehouse", callLogB));
  await analyticsB.track("Order Placed", MALFORMED_ORDER_PAYLOAD as Events["Order Placed"]);
  console.log("  no error thrown -- the malformed payload was forwarded to the provider exactly as given");
  console.log(`  provider call count: ${callLogB.length} (expected 1)`);
  console.log(`  provider received: ${JSON.stringify(callLogB[0]!.payload)}`);

  console.log();
  console.log(`=== Instance C: createGuardedAnalytics() -- the real bundle-stripping recipe, IS_PRODUCTION=${IS_PRODUCTION} ===`);
  const callLogC: CallLogEntry[] = [];
  const analyticsC = createGuardedAnalytics(makeStubProvider("order-warehouse", callLogC));
  if (IS_PRODUCTION) {
    await analyticsC.track("Order Placed", MALFORMED_ORDER_PAYLOAD as Events["Order Placed"]);
    console.log("  IS_PRODUCTION is true -- schemas/validate are both stripped, malformed payload forwarded unvalidated");
  } else {
    try {
      await analyticsC.track("Order Placed", MALFORMED_ORDER_PAYLOAD as Events["Order Placed"]);
      console.log("  unexpectedly succeeded (this should not happen)");
    } catch (error) {
      if (error instanceof EventValidationError) {
        console.log(`  IS_PRODUCTION is false -- schemas/validate are both live, malformed payload rejected: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
  console.log();
  console.log(
    "NOTE: validate:false (Instance B) skips only the RUNTIME check -- it does not, by itself, shrink a production " +
      "bundle. Instance C's createGuardedAnalytics() additionally guards the `schemas` reference itself behind the " +
      "same IS_PRODUCTION check -- see README.md's Production notes for why that second guard is required for real " +
      "bundle-size stripping, and why that's a documented, accepted industry limitation, not a typetrack gap.",
  );
}
