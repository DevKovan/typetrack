# 005 -- Provider guides (`docs/providers/{ga4,posthog,segment}.md`)

## Context

Depends on issue 001 (creates the `docs/providers/` stub files this issue
replaces outright). Independent of issues 002-004, 006-010. One issue, three
files, since they share the exact same structure applied to three different
adapters -- splitting into three issues would triple near-identical
boilerplate for no real isolation benefit (all three packages were read
together during this phase's planning, all three follow one shared
`AnalyticsProvider`-implementation shape).

## Scope of this issue

For each of the three files below, cover (same section order across all
three, for scannability): **Install**, **Quick start**, **Config options**
(a table: option name, type, default, description -- sourced from the
adapter's real exported config interface), **Capabilities** (a table
reproducing that adapter's real `capabilities` object, cited from source --
do not invent/guess a value), **Event & property name mapping** (how
`eventMap`/`propertyMap` override the default table, with the real default
table shown), **Identity model** (how `anonymousId`/`userId` flow from
`CanonicalEvent` into the vendor's own identity concept), **Lifecycle**
(`flush()`/`destroy()` semantics -- especially call out any
terminal-vs-non-terminal distinction), **Limitations** (what this adapter
does *not* support, from its own `capabilities` object -- e.g. no
`group`/`alias` for GA4).

1. **`docs/providers/ga4.md`** -- `createGA4Provider` (`packages/
   provider-ga4/src/index.ts`). No vendor SDK (pure `fetch` to the
   Measurement Protocol) -- state this explicitly as a property, not a
   limitation. `capabilities`: `identify`/`page` true, `group`/`alias`/
   `screen`/`batching`/`offline`/`featureFlags`/`sessionReplay`/`heatmaps`
   false, `runtimes: ["node","browser","edge","bun","deno"]`. Cover
   `identify()`'s real behavior (updates `user_properties` sent on
   subsequent calls -- makes zero network calls itself, since GA4's
   Measurement Protocol has no standalone "set user" endpoint). Cover the
   default event map (`DEFAULT_EVENT_MAP`: "User Signed Up"→`sign_up`,
   "User Logged In"→`login`, "Checkout Started"→`begin_checkout`, "Purchase
   Completed"→`purchase`, "Product Viewed"→`view_item`, "Search
   Performed"→`search`) and default property map (`DEFAULT_PROPERTY_MAP`).
2. **`docs/providers/posthog.md`** -- both `createPostHogProvider` (SDK,
   `posthog-node`) and `createPostHogFetchProvider` (zero-dependency
   `fetch()`, `packages/provider-posthog/src/fetch.ts`) -- a subsection per
   variant, with a short "which one should I use" callout (SDK: built-in
   client-side batching (`flushAt`/`flushInterval`), `featureFlags: true`;
   fetch: zero dependency, runs in more runtimes -- cite each variant's real
   `runtimes` array and explain *why* they differ, per each file's own
   researched `runtimes` comment). Cover the shared `./mapping.ts` (both
   variants produce byte-for-byte-equivalent translated names/properties for
   the same config). Cover `$identify`/`$groupidentify`/`$create_alias`
   special-event mapping for identify/group/alias, cited from source.
3. **`docs/providers/segment.md`** -- both `createSegmentProvider` (SDK,
   `@segment/analytics-node`) and `createSegmentFetchProvider` (zero-
   dependency `fetch()` + HTTP Basic Auth, `packages/provider-segment/src/
   fetch.ts`) -- same "which one should I use" framing as PostHog's guide.
   Explicitly document the `flush()` (non-terminal) vs. `destroy()`
   (terminal, calls `closeAndFlush()`) distinction -- cite the SDK
   adapter's own lifecycle-design comment, since this is a documented,
   easy-to-get-wrong subtlety (the pre-rewrite adapter had this backwards,
   per that same comment). Cover the six real HTTP endpoints the fetch
   variant uses (`/v1/track`, `/v1/page`, `/v1/screen`, `/v1/identify`,
   `/v1/group`, `/v1/alias`) and that `/v1/batch` is out of scope (cite the
   fetch adapter's own citation comment).

Every config-option/capability table's values must be copied from the real
source interface/object, not summarized from memory -- re-read each
adapter's `index.ts`/`fetch.ts` while writing its table.

## Testing

Documentation-only. Verify every capability-table value and config-option
name against the real, current source. Run `bun run lint`, `bun run
typecheck`, `bun test`, `bunx knip`.

## Out of scope

Generic `AnalyticsProvider` interface explanation -- issue 002. Migration-
from-vendor narrative -- issue 004 (this issue is reference documentation
for someone who has already decided to use a given adapter, not a
"switching from X" narrative).
