# 007 -- Middleware guide (`docs/middleware.md`)

## Context

Depends on issue 001. Independent of issues 002-006, 008-010.

## Scope of this issue

Write `docs/middleware.md`:

1. **What middleware is**: a linear (not onion/wrap) `before`/`after`/
   `onError` chain a `CanonicalEvent` runs through for `track`/`page`/
   `screen` only (`identify`/`group`/`alias`/`reset`/`flush`/`destroy` have
   no `CanonicalEvent` and never run through it) -- cite `src/
   middleware.ts`'s `Middleware` interface. Registration: `.use(middleware)`,
   accumulates in registration order, no dedup by `name`.
2. **Execution order, precisely**: `before` chain runs in registration
   order, each middleware's return value threading into the next; a
   `before()` returning `null`/`undefined` drops the event (no dispatch, no
   `after` chain, resolves normally); dispatch runs against the
   post-`before`-chain event; `after` chain then runs in registration order
   (not reversed) against that same event, observing only. `onError`: a
   `before`/`after` throw is reported to the throwing middleware and every
   middleware before it in the chain (not later ones); a provider-dispatch
   failure is reported to every registered middleware's `onError`. Cite
   `src/middleware.ts`'s `runBeforeChain`/`runAfterChain` and `src/
   index.ts`'s `runThroughMiddleware`/`notifyOnError`.
3. **One subsection per built-in middleware** (all six, from `src/
   middleware/*.ts`), each covering: what it does, its `Options` type,
   default behavior, and one real cited code sample:
   - `redactMiddleware(options)` -- exact (possibly dotted) field-path
     redaction, replace-not-delete semantics (cite the module's own "Design
     note: replace, not delete" comment), `targets` (default
     `["properties"]`).
   - `piiFilterMiddleware(options?)` -- recursive key-*name*-pattern
     redaction (including into arrays), the built-in `DEFAULT_PATTERNS`
     list, `extendDefaults`, and the explicit "complementary to
     `redactMiddleware`, not a replacement" framing (cite the module's own
     doc comment).
   - `samplingMiddleware({ rate })` -- global, pre-dispatch, one-time-per-
     event gate; the two-layer distinction from `ProviderEntry.sampling`
     (per-provider, evaluated later) -- reproduce this module's own
     documented distinction accurately, it's a common point of confusion.
   - `loggingMiddleware(options?)` -- the one built-in exercising all three
     hook types (`before`/`after`/`onError`), useful as the reference
     "full-coverage middleware" shape for a custom one.
   - `enrichmentMiddleware(options)` -- static-or-function
     `properties`/`context` merge, "enrichment overrides on key collision"
     precedence (cite the module's own comment).
   - `versionMiddleware(options)` -- `appVersion`/`buildId` injected into
     `event.metadata`, non-clobbering merge with existing `metadata` keys,
     configured-value-wins-on-collision.
   - `timingMiddleware({ onTiming, now? })` -- `before`-to-`after`
     wall-clock duration, per-event `WeakMap` pairing (not a single shared
     "last start" variable -- explain *why*: concurrent/interleaved
     `track()` calls), and the important **registration-order caveat**:
     must be registered after any event-*transforming* middleware in the
     chain (cite the module's own "Ordering note" comment) -- this is a
     real footgun worth calling out prominently, not buried.
4. **Writing custom middleware**: the `Middleware` interface again as a
   quick reference, plus a short example combining two built-ins to show
   registration order mattering in practice (e.g. `redactMiddleware`
   registered before `loggingMiddleware` so logs never show the redacted
   value) -- cite `examples/middleware/pipeline-basics` if its content
   matches, otherwise construct a short illustrative sample per BRIEF.md
   Design decision 3.

## Testing

Documentation-only. Verify every behavioral claim (especially the
`samplingMiddleware`-vs-routing distinction and `timingMiddleware`'s
ordering caveat) against the real current source, not from memory. Run
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip`.

## Out of scope

Plugins -- issue 006. Provider-level routing (`ProviderEntry.include`/
`exclude`/`predicate`/`sampling`) -- issue 002 (architecture guide) and
issue 003 (cookbook) cover it; this guide only contrasts it against
`samplingMiddleware` where relevant, doesn't re-document it fully.
