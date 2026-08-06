# schema-versioning

Demonstrates issue 004's `schemaVersion` tag plus the additive-vs-breaking
schema-evolution discipline from
`plan/phase-15-validation-hardening/BRIEF.md`'s Design decision 3: a
`"Purchase Completed"` schema at `schemaVersion: "2026.1"`, an additive
change (a new optional `currency` field, no version bump), and a labeled
section showing what a **breaking** change looks like done *correctly* --
via a new event name plus a `schemaVersion` bump, never an in-place mutation
of what an existing field means.

This example is intentionally more narrative/README-heavy than the other two
-- it's demonstrating a discipline/convention, not just one API call.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/validation/schema-versioning
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/validation/schema-versioning/index.ts
```

## Source

**Section 1-2 (current version + additive change)** share one schema and one
`createAnalytics()` instance:

```ts
// As first shipped (schemaVersion "2026.1"): { orderId, total }.
const purchaseCompletedSchemaV1AsShipped = z.object({
  orderId: z.string(),
  total: z.number(),
});

// Later, additively -- STILL "2026.1", no version bump: `currency` added.
const purchaseCompletedSchemaCurrent = z.object({
  orderId: z.string(),
  total: z.number(),
  currency: z.string().optional(),
});

const analytics = createAnalytics({
  provider,
  schemas: { "Purchase Completed": purchaseCompletedSchemaCurrent },
  schemaVersion: "2026.1",
});
```

Both the original shape (`{ orderId, total }`) and the additive shape
(`{ orderId, total, currency }`) validate against this *same* schema, through
this *same* instance -- no version bump, no call-site changes needed.

**Section 3 (a breaking change, done correctly)** uses a genuinely separate
event name, schema, `schemaVersion`, and a `deprecatedEvents` redirect from
the old name:

```ts
const purchaseCompletedV2Schema = z.object({
  orderId: z.string(),
  amountCents: z.number().int().nonnegative(), // replaces `total` (dollars)
  currency: z.string().optional(),
});

const analytics = createAnalytics({
  provider,
  schemas: { "Purchase Completed V2": purchaseCompletedV2Schema },
  schemaVersion: "2027.1",
  deprecatedEvents: {
    "Purchase Completed": {
      replacement: "Purchase Completed V2",
      sunsetDate: "2027-06-01",
      message: "total (dollars) was replaced by amountCents (integer cents) -- update call sites to the new payload shape.",
    },
  },
});
```

### Design choice: Section 3 is runnable, not just a README code block

Issue 005 allows the breaking-change path to be either a second runnable
section in `index.ts` or an explained code block here in the README, since a
fully separate runnable scenario risked being redundant with
`../deprecated-event-rename`'s own coverage. **This example makes it
runnable** (Section 3 in `index.ts`), because it demonstrates something
`deprecated-event-rename` does *not*: a field-level *meaning* change
(`total` dollars -> `amountCents` integer cents), not just an event-*name*
rename. Making it runnable lets `index.integration.test.ts` assert, against
the real `typetrack` package, that redirecting the event *name* alone is
**not** sufficient for a field-shape breaking change -- the old call site's
*payload* must still be updated, even though its *name* redirects for free.
That distinction is the whole point of this section, and prose alone
wouldn't prove it stays true as the codebase evolves.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
output of `bun run index.ts` (stdout and stderr combined -- exactly
reproducible on every run, nothing here depends on any random value).

## Explanation

- **Section 1** tracks the original shape (`{ orderId, total }`) through the
  current-version instance. It validates, and the delivered event's
  `metadata` carries `{ schemaVersion: "2026.1" }`.
- **Section 2** tracks the additive shape (`{ orderId, total, currency }`)
  through the *same* instance, the *same* schema, the *same* `schemaVersion`.
  It validates too -- Zod's own `.optional()` already covers additive
  evolution within one schema, with zero new typetrack API surface and zero
  version bump.
- **Section 3** first calls the *old* event name (`"Purchase Completed"`)
  with the *old* payload shape (`{ orderId, total }`), through the V2
  instance. `deprecatedEvents` transparently redirects the event *name* to
  `"Purchase Completed V2"` (visible both in the warning line and in the
  thrown `EventValidationError`'s `.event` field) -- but the V2 schema
  expects `amountCents`, not `total`, so validation still fails. The
  *updated* call site (`{ orderId, amountCents, currency }`, tracked under
  the new name directly) then validates and is stamped with
  `{ schemaVersion: "2027.1" }`.

## Production notes

- **The additive-vs-breaking distinction is the whole discipline this
  example teaches**, per `BRIEF.md`'s research grounding (current, 2026
  sources on schema evolution/versioning): a new **optional** field is
  additive and safe -- no version bump needed, Zod's `.optional()`/union
  primitives already cover it. A field **rename, removal, or meaning
  change** is breaking -- it needs a new event name (or an explicit version
  boundary), **never** an in-place mutation of what an existing field means.
  Mutating `purchaseCompletedSchemaCurrent`'s `total` field in place to mean
  "cents instead of dollars" would silently break every downstream consumer
  (dashboards, warehouses, other services) still reading it as dollars, with
  no compile-time or even necessarily runtime signal that anything changed.
- **`schemaVersion` is a single, flat, instance-level tag -- not a
  per-event, multi-version runtime resolver.** `createAnalytics({
  schemaVersion })` stamps that one value onto `metadata.schemaVersion` for
  every `track()` call from that instance; a caller's own explicit
  `trackOptions.metadata.schemaVersion` always wins over the instance
  default. There is no `schemas: { event: { 1: schemaV1, 2: schemaV2 } }`
  concurrent-multi-version lookup table in `typetrack`, and this phase
  deliberately does not build one -- see `BRIEF.md`'s Design decision 3 for
  the full reasoning (no current ROADMAP/VISION need for it, and Zod's own
  primitives already cover the additive case that's the common one in
  practice).
- **Most orgs cut schema/tracking-plan versions quarterly or annually, not
  per commit** (per BRIEF.md's research grounding) -- `schemaVersion` values
  like `"2026.1"`/`"2027.1"` in this example follow that cadence
  deliberately, rather than e.g. a semver-per-deploy scheme.
- **`deprecatedEvents` handles the event-*name* half of a breaking change;
  it does not, and cannot, validate that an old-shaped *payload* matches a
  new schema.** As Section 3 shows, redirecting the name is necessary but
  not sufficient for a genuine field-level breaking change -- the call
  site's payload still needs updating. Compare this directly against
  [`../deprecated-event-rename`](../deprecated-event-rename), where the
  change is *purely* a name rename with an unchanged payload shape, so the
  old call site needs literally zero changes at all.
