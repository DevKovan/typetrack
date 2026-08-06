# deprecated-event-rename

A realistic tracking-plan migration: an app originally shipped
`"checkout_started"` (snake_case, an early convention) and is migrating its
whole tracking plan to Title Case event names (`"Checkout Started"`).
Demonstrates issues 001/002's `deprecatedEvents` option: the old call site
keeps compiling and working, completely unmodified, while the event that
actually reaches providers (and gets schema-validated, if a schema exists)
is the new, renamed one.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/validation/deprecated-event-rename
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/validation/deprecated-event-rename/index.ts
```

## Source

The whole migration is a single config value:

```ts
export const deprecatedEventsConfig: DeprecatedEventsMap = {
  checkout_started: {
    replacement: "Checkout Started",
    sunsetDate: "2027-01-01",
  },
};

const analytics = createAnalytics({ provider, deprecatedEvents: deprecatedEventsConfig });
```

The old call site, `trackLegacyCheckoutStart()`, is never touched:

```ts
export async function trackLegacyCheckoutStart(analytics, cartValue: number): Promise<void> {
  await analytics.track("checkout_started", { cartValue });
}
```

`runCheckoutMigrationDemo()` calls it 3 times through the same `Analytics`
instance, counting real `console.warn` invocations along the way (without
swallowing them -- the warning text still prints normally).

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
output of `bun run index.ts` (stdout and stderr combined -- exactly
reproducible on every run, nothing here depends on any random value).

## Explanation

- The old call site (`analytics.track("checkout_started", { cartValue })`)
  is called 3 times, unmodified.
- The deprecation warning (`typetrack: event "checkout_started" is
  deprecated -- use "Checkout Started" instead. Planned removal:
  2027-01-01.`) fires exactly **once**, even across all 3 calls --
  typetrack's warn-once-per-event-name behavior, scoped to one `Analytics`
  instance's lifetime.
- Every one of the 3 events the stub provider receives arrives under the
  **resolved** name, `"Checkout Started"` -- never the original
  `"checkout_started"`. A `deprecatedEvents` entry with a `replacement`
  auto-redirects every downstream use of the deprecated name (schema lookup,
  `CanonicalEvent.name`, provider dispatch) to the new one.

## Production notes

- **This is `plan/VISION.md`'s Golden Rule, applied to event naming instead
  of provider choice.** `typetrack`'s core value proposition ("Prisma for
  Analytics") is that switching something vendor/naming-related is a
  **one-file config change, not an application-code sweep**. A
  `deprecatedEvents` entry is exactly that: rename one event across an
  entire tracking plan by editing one config object -- no `grep`-and-replace
  across every `track()` call site scattered through checkout pages, cart
  -abandonment email triggers, or anywhere else in a real codebase.
- **The warning is deliberate, not silent.** Per
  `plan/phase-15-validation-hardening/BRIEF.md`'s research grounding,
  current industry guidance converges on "ship the new event alongside the
  old, warn, run both until dashboards/call sites are migrated, then remove"
  -- deprecation is meant to be a *visible, timed* transition. The
  `sunsetDate` in this example's config (`"2027-01-01"`) is purely
  informational -- typetrack never enforces or compares it against the
  current date; it only ever surfaces in the warning text for a human
  reading console output.
- **A `replacement` auto-redirects; an entry with no `replacement` only
  warns.** This example uses the redirect form. An app that wants a pure
  retirement notice with no auto-redirect (e.g. an event that's simply being
  removed, with nothing to rename it to) would omit `replacement` --
  `resolveDeprecatedEvent` then leaves the event firing under its original
  name, warning only.
- **`deprecatedEvents` keys are plain strings, not constrained by the app's
  `Events` type.** This is intentional: the whole point of this map is to
  catch calls using a name that has *already been removed* from an app's
  current, typed `Events` map (or a raw JS caller with no compile-time check
  at all) -- constraining its keys to `keyof Events` would make it
  impossible to name the exact strings it exists to catch.
- **Performance**: `resolveDeprecatedEvent()` runs synchronously in the hot
  path of every `track()` call -- a single object-property lookup, negligible
  cost, evaluated fresh per call (no caching, no precomputation).
