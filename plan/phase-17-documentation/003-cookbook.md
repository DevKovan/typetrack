# 003 -- Cookbook (`docs/cookbook.md`)

## Context

Depends on issue 001 (`docs/README.md` links here). Independent of issues
002, 004-010 -- can be written in any order relative to them.

## Scope of this issue

Write `docs/cookbook.md`: short, task-oriented "how do I...?" recipes, each
a heading + 1-2 sentences of context + one code sample (per BRIEF.md Design
decision 3 -- verbatim-with-citation from a real source, preferring
`examples/**` since that's exactly what those directories exist for) + a
one-line pointer to the deeper guide/example directory when one exists.
This is a lookup reference, not a tutorial to read start-to-finish -- keep
each recipe self-contained.

Cover, at minimum, one recipe each for:

1. **Switch providers without touching application code** -- cite
   `examples/core/provider-switch/app.ts` + its multiple entry points.
2. **Send events to more than one provider at once** -- `provider: [...]`
   array fan-out, cite `examples/providers/multi-provider-routing`.
3. **Route different events to different providers** (`include`/`exclude`/
   `predicate` on a `ProviderEntry`) -- cite `src/routing.ts`'s
   `shouldRouteToProvider` + the multi-provider-routing example.
4. **Type your events at compile time** -- `EventMap`, `Events` generic on
   `createAnalytics<Events>()`, cite `examples/core/canonical-event-shape`.
5. **Validate event payloads at runtime with Zod** -- `schemas`,
   `SchemaMap`, `onValidationError`, cite `src/schema.ts` +
   `examples/validation/*`.
6. **Redact or filter PII before it reaches a provider** --
   `redactMiddleware`/`piiFilterMiddleware`, cite `src/middleware/
   {redact,piiFilter}.ts`; point to `docs/middleware.md` for the full
   guide.
7. **Sample a fraction of events globally, vs. per-provider** --
   `samplingMiddleware` vs. `ProviderEntry.sampling`, cite `src/middleware/
   sampling.ts`'s own module doc comment (it already documents this exact
   distinction) + `examples/middleware/sampling-vs-routing`.
8. **Gate tracking behind user consent** -- `consent` option,
   `analytics.consent.grant()`/`.deny()`, cite `examples/recipes/
   consent-gated-tracking`.
9. **Track anonymously / go cookieless** -- `anonymousMode`, `cookieless`,
   cite `examples/recipes/anonymous-and-cookieless-tracking`.
10. **Keep tracking working offline** -- `reliability` option,
    `analytics.queue`, cite `examples/advanced/offline-resilient-tracking`.
11. **Auto-capture browser/device/session context** -- `context: true` /
    `ContextOptions`, cite `examples/core/context-capture`.
12. **Wire up automatic pageview tracking in a plain browser app** (no
    framework router) -- `autoPage()`, cite `src/plugins/autoPage.ts`.
13. **Rename or retire an event without breaking existing dashboards** --
    `deprecatedEvents`, cite `examples/validation/deprecated-event-rename`.
14. **Strip validation from a production bundle** -- `validate: process.env
    .NODE_ENV !== "production"`, cite `examples/validation/
    production-stripping`.
15. **Run `typetrack dev` to inspect events locally** -- `devServer`
    option + the `typetrack dev` CLI, cite `src/cli/dev.ts` and `src/
    devServer/server.ts`'s route table (`/events`, `/events/stream`,
    `/schema`, `/health`).

The implementor may add a small number of additional recipes if a genuinely
common task surfaced while reading `examples/**` isn't covered above, but
should not pad the list with trivial variations of an existing recipe.

## Testing

Documentation-only. Verify every citation resolves to a real file/export
(re-check by reading, not from memory). Run `bun run lint`, `bun run
typecheck`, `bun test`, `bunx knip`.

## Out of scope

Full narrative architecture explanation -- issue 002. Provider-specific
config reference -- issue 005.
