# 004 -- Migration guide (`docs/migration.md`)

## Context

Depends on issue 001. Read `plan/phase-17-documentation/BRIEF.md`'s Design
decision 5 first (the `EventMeta` section must stay short/historical, not a
padded runbook -- there is no real installed pre-Phase-6 consumer base to
migrate). Independent of issues 002-003, 005-010.

## Scope of this issue

Write `docs/migration.md` with four sections:

1. **From direct `posthog-node`/`posthog-js` usage.** A short before/after:
   `posthog.capture({ distinctId, event, properties })` next to
   `createAnalytics({ provider: createPostHogProvider({ apiKey }) });
   analytics.track(...)`. Cover: `identify`/`group`/`alias`/`page` call
   mapping (cite `packages/provider-posthog/src/index.ts`'s
   `createPostHogProviderWithClient` body for the exact `$identify`/
   `groupIdentify`/`alias`/`$pageview` translation), the event/property
   name mapping table (`eventMap`/`propertyMap`, cite `packages/
   provider-posthog/src/mapping.ts`), and that both an SDK-based
   (`createPostHogProvider`) and zero-dependency `fetch()`-based
   (`createPostHogFetchProvider`) adapter exist -- point to `docs/
   providers/posthog.md` for the full reference rather than duplicating it.
2. **From direct `@segment/analytics-node` usage.** Same shape: before/after
   for `analytics.track({ userId, event, properties })`, identity-field
   handling (`identityFrom()` in `packages/provider-segment/src/index.ts`),
   the `flush()`-is-non-terminal / `destroy()`-is-terminal lifecycle
   distinction (cite that file's own lifecycle-design comment on
   `createSegmentProvider`), and the SDK-based vs. HTTP-Basic-Auth
   `fetch()`-based (`createSegmentFetchProvider`) pair. Point to `docs/
   providers/segment.md`.
3. **From direct GA4 Measurement Protocol usage.** Before/after for a raw
   `fetch("https://www.google-analytics.com/mp/collect", ...)` call vs.
   `createGA4Provider({ measurementId, apiSecret })`. Cover the default
   canonical→GA4 event-name table (`DEFAULT_EVENT_MAP` in `packages/
   provider-ga4/src/index.ts` -- "User Signed Up" → `sign_up`, etc.) and
   that GA4 has no vendor SDK at all here (pure `fetch`, one adapter, no
   SDK/fetch pair unlike PostHog/Segment). Point to `docs/providers/ga4.md`.
4. **From this repo's own pre-Phase-6 `EventMeta` shape** (short,
   historical -- see BRIEF.md Design decision 5 for why this stays brief).
   State what `EventMeta` was (a bare `{ timestamp }` passed alongside
   `track()`'s positional `event`/`payload` arguments, per the root
   `README.md`'s pre-refresh sample that issue 001 corrected) and what
   `CanonicalEvent` (`src/schema.ts`) replaced it with and why (identity/
   session/context centralized in core once, instead of every adapter
   reinventing it) -- cite `plan/CHANGELOG.md`'s Phase 6 entry (or `plan/
   phase-6-canonical/BRIEF.md` if it exists in this repo -- check before
   citing either) as the source of record for that decision. No
   step-by-step upgrade instructions needed (there's no real external
   consumer of the old shape) -- a clear "here's what changed and why" is
   sufficient.

Every code sample follows BRIEF.md Design decision 3 (verbatim-with-citation
or clearly-labeled illustrative). A "direct vendor SDK" before-sample is
illustrative pseudo-code by nature (it's demonstrating *not* using
typetrack) -- label it as such rather than implying it was copy-pasted from
this repo.

## Testing

Documentation-only. Verify every citation resolves. Confirm whether `plan/
phase-6-canonical/BRIEF.md` exists before citing it (fall back to `plan/
CHANGELOG.md`'s Phase 6 entry if not). Run `bun run lint`, `bun run
typecheck`, `bun test`, `bunx knip`.

## Out of scope

Full per-adapter config reference -- issue 005. Comparison-table-style
capability comparisons -- issue 009 (`docs/comparison.md`) covers "why
typetrack" more broadly; this guide covers "how do I move my existing code".
