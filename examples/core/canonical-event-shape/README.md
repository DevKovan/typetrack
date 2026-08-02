# canonical-event-shape

Demonstrates the canonical event model that every `typetrack` provider
receives: no matter which real vendor (GA4, PostHog, Segment, ...) an app
actually plugs in, the object a provider's `track()`/`page()`/`screen()`
method gets is always a `CanonicalEvent` -- the same shape shown here.

## Prerequisites

- Bun installed (this example is Bun-only, like the rest of this repo).
- Run from the *monorepo root* first: `bun install` (this example depends on
  the local, in-repo `typetrack` package via `file:../../..`, not a
  published npm version).

## How to run

```sh
cd examples/core/canonical-event-shape
bun run index.ts
```

or, from anywhere in the repo:

```sh
bun run examples/core/canonical-event-shape/index.ts
```

## Source

`index.ts` builds an `Analytics` instance with a small, hand-written
`AnalyticsProvider` (`loggingProvider`) that just logs whatever it receives,
then runs a realistic signup flow against it:

```ts
const analytics = createAnalytics({ provider: loggingProvider });

await analytics.track(
  "User Signed Up",
  { plan: "pro" },
  { context: { locale: "en-US" }, metadata: { source: "web" } },
);

await analytics.identify("user_42", { email: "ada@example.com", plan: "pro" });

await analytics.group("acme-inc", { name: "Acme Inc", tier: "enterprise" });

await analytics.track("Checkout Started", { cartValue: 129.99, itemCount: 3 });
```

The whole flow is wrapped in an exported `runSignupFlow(provider)` function
(rather than only running inline) so the same call sequence can be re-run
against a different provider in `index.integration.test.ts`, without
duplicating the scenario.

## Expected output

See [`expected-output.txt`](./expected-output.txt) for the full literal
output, or the "Explanation" section immediately below for the annotated
version.

## Explanation

Every canonical field on the first logged event, and why it looks the way
it does:

- **`name`** (`"User Signed Up"`): exactly the first argument passed to
  `track()`, unchanged. Core never renames/translates event names -- that's
  a provider adapter's job (see `examples/core/provider-switch`).
- **`properties`** (`{ "plan": "pro" }`): the second `track()` argument,
  unchanged (no `schemas` were configured for this example, so nothing is
  validated/coerced).
- **`timestamp`**: `Date.now()`, captured by core at the moment `track()`
  runs -- not supplied by the caller, not supplied by the provider.
- **`anonymousId`**: a `crypto.randomUUID()` generated once, the moment
  `createAnalytics()` was called -- this is what identifies this specific
  device/browser/process before (and independent of) any `identify()` call.
- **`sessionId`**: likewise a `crypto.randomUUID()` generated once at
  `createAnalytics()` time. Real apps would typically want this
  regenerated on a schedule/on app restart -- this example calls
  `createAnalytics()` exactly once, so it never changes.
- **`userId`**: absent (`undefined`, dropped from the JSON) on the *first*
  event -- `identify()` hasn't been called yet at that point in the flow.
- **`context`** / **`metadata`**: exactly the `TrackOptions` passed as the
  third `track()` argument, passed through unmodified. These exist
  precisely so callers can attach request-scoped data (locale, IP, user
  agent, ...) or app-internal bookkeeping (event source) without
  polluting `properties` (which providers may map field-by-field, e.g. to
  GA4 params -- see the provider-switch example).

Then, the *second* `track()` call (after `identify()`) shows:

- **`userId`** is now `"user_42"` -- `identify()` is the only verb that
  updates core's stored `userId`, and every event built afterwards carries
  it.
- **`anonymousId`** / **`sessionId`** are unchanged -- identity/session
  state persists across calls (only `reset()` regenerates it).
- **`context`** / **`metadata`** are both absent -- this call passed no
  `TrackOptions`, demonstrating both are always optional per call, not
  global.

`identify()` and `group()` aren't `CanonicalEvent`s themselves (there's no
"event name" or "properties" being tracked) -- they carry their own
positional arguments (`userId`/`traits`/`anonymousId`, and
`groupId`/`traits`/`{ userId, anonymousId }` respectively), which is why
`loggingProvider` logs them with a different, ad hoc format instead of
`JSON.stringify`-ing a `CanonicalEvent`.

## Production notes

- **Never log full events containing PII to stdout in production.** This
  example logs entire `CanonicalEvent` objects (including trait/property
  payloads that, in a real app, likely contain email addresses, names, or
  other PII) purely for illustration. A production `AnalyticsProvider`
  should send data directly to its destination (or an internal queue/log
  pipeline with proper access controls and redaction), not `console.log` it.
- **`loggingProvider` is a teaching tool, not a real provider.** Real
  providers live in `packages/provider-*` (or your own adapter) and talk to
  an actual vendor/backend; this example's provider exists only to make the
  canonical shape visible without needing any vendor account.
- **Identity/session IDs are in-memory only.** This example calls
  `createAnalytics()` once per process and never persists `anonymousId`
  across restarts -- a real client-side app typically wants to persist
  `anonymousId` (e.g. in `localStorage`/a cookie) so the same
  device/browser is recognized across sessions; that persistence is an
  app/provider concern, not something core does automatically.
