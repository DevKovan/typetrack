# 007 — `piiFilterMiddleware`: pattern-based, recursive PII key-name redaction

## Context

Independent of issues 002-006 (a new built-in middleware, following the
exact registration/opt-in mechanism Phase 8 already established — no
`createAnalytics()` core changes needed, `.use()` already exists). Read
`src/middleware/redact.ts` in full before starting — this issue is
deliberately **complementary to, not a replacement for**, the existing
`redactMiddleware`:

- `redactMiddleware` (Phase 8): the app enumerates exact (possibly dotted)
  field **paths** to redact (e.g. `"user.ssn"`); does not descend into
  arrays; a path that doesn't exist is a silent no-op.
- `piiFilterMiddleware` (this issue): the app supplies (or relies on
  sensible defaults for) **key-name patterns** (e.g. anything named
  `"email"`/`"ssn"`/`"password"` at any depth, in any nested object or
  array-of-objects), without needing to know or enumerate the exact path
  in advance. This is genuinely additive coverage — e.g. a `properties.
  lineItems: [{ email: "..." }, { email: "..." }]` array is redacted by
  this middleware but not reachable by `redactMiddleware`'s exact-path
  model at all.

Both middlewares may be composed together (`.use(redactMiddleware(...))`
+ `.use(piiFilterMiddleware(...))`); neither supersedes the other.

## Scope of this issue

New `src/middleware/piiFilter.ts`, exporting:

- `PiiFilterOptions`:
  - `patterns?: (string | RegExp)[]` — additional key-name patterns beyond
    the built-in defaults. A plain string pattern matches
    case-insensitively as a **substring** of the key name (e.g. `"email"`
    matches a key named `"userEmail"` or `"EMAIL_ADDRESS"`); a `RegExp` is
    tested against the key name as-is (case sensitivity is the caller's
    responsibility via flags).
  - `extendDefaults?: boolean` — default `true` (supplied `patterns` are
    merged with the built-in default list); `false` replaces the built-in
    list entirely with only `patterns`.
  - `replacement?: unknown | ((fieldPath: string, value: unknown) => unknown)`
    — same shape and default (`"[REDACTED]"`) as `redactMiddleware`'s
    option of the same name, for consistency; `fieldPath` here is the
    dotted path this middleware computed during its own recursive walk
    (e.g. `"lineItems.0.email"` for an array element), not a
    caller-supplied path.
  - `targets?: ("properties" | "context" | "metadata")[]` — same default
    (`["properties"]`) and semantics as `redactMiddleware`.
- `piiFilterMiddleware(options?: PiiFilterOptions): Middleware` — a
  `before()`-only middleware (no `after()`/`onError()`, matching
  `redactMiddleware`'s precedent — nothing to observe/react to after
  dispatch).
- A documented, non-exhaustive default pattern list covering common PII
  key-name shapes: `email`, `phone`/`phoneNumber`, `ssn`/
  `socialSecurityNumber`, `password`/`passwd`, `creditCard`/`cardNumber`/
  `cvv`, `address`/`street`/`zipcode`/`postalCode`, `dob`/`dateOfBirth`/
  `birthdate`. Document explicitly that this is a starting point, not a
  compliance guarantee — apps with specific regulatory obligations should
  supply their own `patterns`.
- Recursive descent behavior (the key differentiator from
  `redactMiddleware`): walks every plain object and array in the target
  (`properties`/`context`/`metadata`) to arbitrary depth; a matching key
  at any depth has its value replaced; array elements that are plain
  objects are recursed into (their own keys checked against the
  patterns), array elements that are not plain objects (primitives,
  `null`) are left untouched. Never mutates the input event — returns a
  new event with only the objects/arrays along a redacted path
  shallow-cloned (siblings off any redacted path keep their original
  references), mirroring `redactMiddleware`'s existing non-mutation
  contract. Assumes JSON-safe (non-cyclic) event payloads — no cycle
  detection is required or attempted; document this assumption rather
  than silently handling or silently breaking on a cyclic input.

## Design decisions made in this issue

- **Key-name pattern matching only — no value-content scanning.**
  Detecting an email-*shaped string value* under an unexpected key name
  (e.g. `properties.notes` containing a raw email address) is real,
  separate, higher-risk-of-false-positive scope, explicitly deferred (see
  BRIEF.md's phase-wide "Out of scope").
- **Substring, case-insensitive matching for string patterns** (not exact
  key match) — chosen so a single default pattern (`"email"`) catches the
  realistic variety of naming conventions apps actually use
  (`email`, `userEmail`, `EMAIL_ADDRESS`, `contactEmail`) without the app
  needing to enumerate every variant; `RegExp` patterns are available for
  callers who need exact-match or more precise control.
- **Same `replacement`/`targets` option shapes as `redactMiddleware`** —
  deliberate consistency, not independently redesigned, so an app already
  familiar with one middleware's options transfers that knowledge
  directly to the other.

## Acceptance criteria

- `src/middleware/piiFilter.ts` exists, exports `PiiFilterOptions` and
  `piiFilterMiddleware` per the above.
- `piiFilterMiddleware()` (no options) redacts every default-pattern-
  matching top-level key in `properties` using `"[REDACTED]"`.
- A nested object (`properties.user.email`) and an array of objects
  (`properties.attendees: [{ email }, { name }]`) are both correctly
  redacted at the matching keys only, leaving non-matching sibling keys
  (e.g. `name`) untouched.
- `extendDefaults: false` with a custom `patterns` list redacts only the
  custom patterns, not the built-in defaults.
- A custom `RegExp` pattern (e.g. `/^internal_/`) works as specified
  (tested as-is against the key name, no implicit case-insensitivity
  unless the regex itself has the `i` flag).
- `replacement` as a function receives the computed dotted `fieldPath`
  (including numeric array-index segments, e.g. `"attendees.0.email"`)
  and the original value.
- `targets` defaults to `["properties"]` only — `context`/`metadata` left
  untouched unless explicitly included.
- The original `CanonicalEvent` object passed in is never mutated
  (assert via reference/deep-equality comparison against a
  pre-middleware-call clone).
- Composes correctly alongside `redactMiddleware` when both are
  `.use()`-registered (registration-order-dependent transform chaining,
  per Phase 8's existing linear-chain contract — no special-cased
  interaction needed, this is just confirming the general middleware
  chain already handles two independent transforms correctly).

## Test requirements

Both unit and integration tests are required.

**Unit tests** (`src/middleware/piiFilter.test.ts`): every branch in
Acceptance criteria above, isolated (constructing the middleware and
calling its `before()` directly against hand-built `CanonicalEvent`
fixtures), mirroring `src/middleware/redact.test.ts`'s existing structure.

**Integration tests** (folded into `src/index.test.ts` or a dedicated
`src/middleware/piiFilter.integration.test.ts`, implementor's choice,
consistent with how other Phase 8 built-ins were tested): register
`piiFilterMiddleware()` via `analytics.use(...)`, call `track()` with a
realistic nested payload containing PII, and assert the provider receives
the redacted event.

## Out of scope

- Value-content (string-shape) PII detection.
- Consent-conditional redaction (e.g. only redact when a category is
  denied) — see BRIEF.md's phase-wide "Out of scope" on middleware/consent
  coupling.
- Any change to `redactMiddleware` itself.
- Export wiring is limited to the public barrel addition (`export {
  piiFilterMiddleware } from "./middleware/piiFilter"; export type {
  PiiFilterOptions } from "./middleware/piiFilter";` in `src/index.ts`) —
  no other `src/index.ts` change.
