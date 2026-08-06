# production-stripping

Demonstrates issue 003's `validate` option (`CreateAnalyticsOptions.validate`)
wired to a simulated bundler env check (`const IS_PRODUCTION =
process.env.NODE_ENV === "production";`, standing in for what a real app's
bundler -- Vite/webpack/esbuild -- would statically replace and dead-code
eliminate at build time). A realistic checkout flow tracks an `"Order
Placed"` event with a malformed payload (types that don't match the schema
at all, simulating data arriving from an untyped/external source), showing
one `createAnalytics()` instance catching it (`validate: true`, the default)
and one letting it through unvalidated (`validate: false`).

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/validation/production-stripping
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/validation/production-stripping/index.ts
```

## Source

`index.ts` defines a real Zod schema for `"Order Placed"`, and derives its
`Events` type from it via `InferEvents` (the same "declare the shape once,
inside the schema" pattern `src/index.schema.integration.test.ts` uses):

```ts
const eventSchemas = {
  "Order Placed": z.object({
    orderId: z.string(),
    amount: z.number().positive(),
  }),
} satisfies Record<string, z.ZodType>;

type Events = InferEvents<typeof eventSchemas>;
```

Three `createAnalytics()` factory functions build 3 instances against the
same schema:

- `createValidatingAnalytics(provider)` -- `validate: true` (issue 003's own
  default; identical to omitting `validate` entirely).
- `createNonValidatingAnalytics(provider)` -- `validate: false`.
- `createGuardedAnalytics(provider)` -- the real recipe: both `validate` and
  the `schemas` reference itself are guarded behind `IS_PRODUCTION`, via the
  pure, directly unit-tested `resolveValidationConfig(isProduction)`:

```ts
export function resolveValidationConfig(isProduction: boolean): ValidationConfig {
  return {
    schemas: isProduction ? undefined : eventSchemas,
    validate: !isProduction,
  };
}
```

The runnable demo tracks the same deliberately malformed payload
(`{ orderId: 42, amount: "nine hundred" }`) through all 3 instances and
reports what happened.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
output of `bun run index.ts` (exactly reproducible as long as `NODE_ENV` is
not set to `"production"` in your shell).

## Explanation

- **Instance A (`validate: true`)** runs `schema.safeParse()` on every
  `track()` call. The malformed payload fails validation, `track()` throws a
  synchronous `EventValidationError`, and the stub provider is never called.
- **Instance B (`validate: false`)** skips `schema.safeParse()` entirely --
  the payload is forwarded to the provider exactly as given, with no error.
- **Instance C (`createGuardedAnalytics()`)** resolves its configuration from
  `IS_PRODUCTION` at construction time. In this repo's own test/demo runs
  (where `NODE_ENV` isn't set to `"production"`), it behaves identically to
  Instance A. Set `NODE_ENV=production` before running to see it behave like
  Instance B instead.

## Production notes

This is the section issue 005 requires to spell out, explicitly, the
two-part reality issue 003's own doc comment already states (and that
`plan/phase-15-validation-hardening/BRIEF.md`'s research grounding confirms
against current, real-world practice):

1. **`validate: false` alone only skips the *runtime check* -- it does not,
   by itself, shrink a production bundle.** Instance B above proves the
   *behavioral* half of this (no `EventValidationError`, ever) but changes
   nothing about what code ships: `eventSchemas` -- and therefore the Zod
   runtime it pulls in -- is still referenced by `createNonValidatingAnalytics`,
   so a real bundler still includes it in the output bundle. A boolean flag
   evaluated at runtime cannot, by itself, make a bundler omit code that's
   still reachable from a live reference.

2. **Actually removing `schemas` (and the validation library that built it)
   from a production bundle additionally requires guarding the *reference to
   that object* the same way** -- e.g. `schemas: IS_PRODUCTION ? undefined :
   realSchemas`, exactly what `createGuardedAnalytics`/`resolveValidationConfig`
   do above. Only once that reference is behind a statically-analyzable,
   env-driven conditional does a real bundler's (Vite/webpack/esbuild's) dead
   -code elimination have anything to actually remove -- this is the same
   `if (process.env.NODE_ENV !== "production")`-guarded-branch pattern used
   by React, Redux Toolkit, Zustand, and effectively every other JS library
   that ships dev-only validation: **the stripping is a property of the
   consuming app's own build, never something a library can perform on
   itself at publish time.** A library ships source/ESM either way; DCE only
   happens when something bundles that source against a real
   `NODE_ENV`/`import.meta.env` value. Current research confirms this
   remains a real, accepted limitation industry-wide: *"it's currently not
   possible to strip developer-added validation imports in production
   without explicit configuration."* This is a **documented, accepted
   industry limitation, not a typetrack gap** -- `typetrack` follows this
   exact precedent (matching its own pre-existing `devServer` design note:
   *"Core never inspects `NODE_ENV`/`import.meta.env`... gating 'am I in dev'
   is entirely the caller's responsibility"*) rather than inventing a new
   policy or pretending a library-side trick could make stripping automatic.
- **`validate` is resolved once at construction**, exactly like
  `anonymousMode`/`cookieless` -- there is no runtime toggle. An app that
  needs to flip this at runtime must construct a new `Analytics` instance.
- **Core never reads `NODE_ENV`/`import.meta.env` itself.** `IS_PRODUCTION`
  in this example is entirely application-level code, written the same way a
  real app would write it -- `typetrack` only ever receives the already
  -resolved boolean/value the caller passes in.
- **Zero Zod runtime dependency in `typetrack` core**, regardless of any of
  this -- `src/schema.ts` imports `z` type-only (`import type { z } from
  "zod"`). Whatever bundle-size cost exists here is entirely attributable to
  what the *consuming app* installs and references (`zod` itself, plus this
  example's own `eventSchemas`), never to `typetrack`.
