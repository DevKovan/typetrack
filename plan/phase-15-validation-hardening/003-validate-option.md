# 003 -- `validate` option: explicit, caller-gated production stripping of runtime validation

## Context

Independent of issues 001/002 (both touch `track()`, but different,
non-overlapping concerns). Implements BRIEF.md Design decision 4 exactly.

Read `src/index.ts`'s `track()` schema-validation block (~line 1119-1134)
and the `devServer?: boolean | { url? }` option's doc comment (~line
80-88) in full before starting -- this issue's `validate` option follows
that exact "core never reads env itself, caller passes an explicit value"
precedent, referenced directly in this issue's own doc comment.

## Scope of this issue

1. `CreateAnalyticsOptions` gains:
   ```ts
   // Phase 15 issue 003: opt-out from runtime schema validation, resolved
   // once at construction (like `anonymousMode`/`cookieless` -- no runtime
   // toggle; construct a new `Analytics` instance to change it). Defaults
   // to `true` -- omitted is zero behavior change from pre-Phase-15: every
   // event with a `schemas[event]` entry is still validated exactly as
   // before. `false` skips `schema.safeParse()` entirely for every event,
   // every call -- the raw payload is forwarded exactly as it would be for
   // an event with no `schemas[event]` entry at all (no
   // `EventValidationError`, `onValidationError` never invoked).
   //
   // Core performs no `NODE_ENV`/`import.meta.env` read anywhere to decide
   // this value -- exactly the same "caller's responsibility" contract as
   // `devServer` above. The intended real-world use is production bundle
   // stripping: an app passes
   // `validate: process.env.NODE_ENV !== "production"` (or the
   // `import.meta.env.DEV` equivalent under Vite/similar), and its own
   // bundler's dead-code elimination removes the `schema.safeParse` call
   // path client-side once that expression is statically `false` -- see
   // `examples/validation/production-stripping` for the full recipe,
   // including why fully removing the `schemas` object (and whatever
   // Zod-based validation library built it) from a production bundle
   // additionally requires the app to guard the *import* of that object
   // the same way, not just this flag.
   validate?: boolean;
   ```
2. Inside `createAnalytics()`, alongside `const schemas = options.schemas;`,
   add `const shouldValidate = options.validate ?? true;`.
3. In `track()`'s validation block, gate the existing `if (schema) { ... }`
   branch with `shouldValidate`:
   ```ts
   const schema = shouldValidate ? schemas?.[resolvedEvent] : undefined;
   ```
   (using `resolvedEvent` if issue 002 has already landed first per the
   BRIEF's stated issue order; if this issue is implemented before 002 in
   practice, use `event` and issue 002's implementor updates this one
   reference when it wires in `resolvedEvent` -- flag either way in the
   PR/commit body so it's traceable). This single-line change is
   sufficient: the existing `if (schema) {...} else { payload = (rawPayload
   ?? {}) as Record<string, unknown>; }` fallback already does exactly the
   "forward raw, unvalidated" behavior this option needs when `schema` is
   `undefined` -- no new branch, no duplicated logic.

## Testing

Unit tests (`src/index.validate.test.ts`) covering: `validate` omitted
(default `true`, byte-for-byte pre-existing behavior -- a failing schema
still throws `EventValidationError`); `validate: true` explicit (same);
`validate: false` with a schema configured for the event -- payload that
would fail validation is forwarded to the provider unvalidated, no throw,
`onValidationError` never called even though it's configured;
`validate: false` with `onValidationError` configured -- confirm the
handler is never invoked (this is the one behavior most worth pinning
down explicitly, since it's easy to accidentally still call it).

No integration test file needed beyond what's already covered by
`src/index.schema.integration.test.ts`'s existing shape -- add one
integration-style case there (or a small sibling
`src/index.validate.integration.test.ts` if that file's existing scope
reads as schema-specific enough to warrant a separate file; implementor's
call, follow whichever keeps the diff smaller) exercising `validate:
false` through a real multi-provider `createAnalytics()` setup.

## Out of scope

Any change to `SchemaMap`/`EventValidationError`/`InferEvents` types.
Any `tsup.config.ts` change (per BRIEF.md Design decision 5 -- this option
is pure runtime, no build-system involvement).
