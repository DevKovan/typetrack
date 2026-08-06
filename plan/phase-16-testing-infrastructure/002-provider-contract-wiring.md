# 002 -- Wire the contract kit into all five provider factories, dedupe overlap

## Context

Depends on issue 001 (`packages/provider-contract-kit`) existing and
passing its own tests. This issue touches all three provider packages:
`provider-ga4`, `provider-posthog` (two factories:
`createPostHogProvider`/`createPostHogProviderWithClient`, and
`createPostHogFetchProvider`), `provider-segment` (two factories:
`createSegmentProvider`/`createSegmentProviderWithClient`, and
`createSegmentFetchProvider`) -- five harnesses total.

Add `@typetrack/provider-contract-kit` as a `devDependency` (test-only, so
`devDependencies`, not `dependencies`) of each of the three provider
packages, via `workspace:*` (a true `packages/*`-to-`packages/*` sibling
dep now, unlike the kit's own `typetrack` dependency -- per CLAUDE.md's
established rule).

## Scope of this issue

For each of the five factories, add one new test file
(`<adapter>.contract.test.ts`, e.g. `packages/provider-ga4/src/
index.contract.test.ts`, `packages/provider-posthog/src/
index.contract.test.ts`, `packages/provider-posthog/src/
fetch.contract.test.ts`, `packages/provider-segment/src/
index.contract.test.ts`, `packages/provider-segment/src/
fetch.contract.test.ts`) that:

1. Builds a `ProviderContractHarness` reusing that file's own existing
   transport-stubbing approach -- for the two fetch-based packages
   (GA4, both `*.fetch.ts` adapters), stub `globalThis.fetch` in
   `beforeEach`/`afterEach` exactly as `index.test.ts`/`fetch.test.ts`
   already do, with `createProvider()` wiring the stub to return a 2xx
   `Response` and `createFailingProvider()` wiring it to return a non-2xx
   `Response` (or reject); for the two SDK-based packages (PostHog,
   Segment `index.ts`), build a hand-written fake client object
   implementing `PostHogClientLike`/`SegmentClientLike` (per this
   package's own established dependency-injection pattern -- **never**
   `mock.module()`, per CLAUDE.md's standing rule) whose methods succeed
   for `createProvider()` and whose relevant method throws for
   `createFailingProvider()`.
2. Calls `runProviderContractTests(harness)`.

Then, in each package's **pre-existing** test file(s), remove the `it()`
blocks whose assertions are now fully subsumed by the generic contract
suite. Concretely, these existing assertions are removal candidates (grep
titles are exact, from the current `main`):

- `provider-ga4/src/index.test.ts`: `"capabilities matches the declared
  table exactly"`, `"declares runtimes: fetch-only, no Node-specific API
  usage"`.
- `provider-posthog/src/index.test.ts`: `"capabilities matches the
  declared table exactly"`, `"declares runtimes: node/edge/bun/deno per
  posthog-node's own edge export conditions, browser excluded"`,
  `"reset() does not throw and does not call any client method"`.
- `provider-posthog/src/fetch.test.ts`: `"capabilities matches the exact
  declared table"`, `"declares runtimes: fetch-only, no vendor SDK
  import"`, `"reset() does not throw and makes zero fetch calls"`.
- `provider-segment/src/index.test.ts`: `"capabilities matches the
  declared table exactly"`, `"declares runtimes: node/bun/deno only, per
  @segment/analytics-node's lack of edge/browser export conditions"`.
- `provider-segment/src/fetch.test.ts`: `"capabilities matches the exact
  declared table (no batch key)"`, `"declares runtimes: fetch-only, no
  vendor SDK import"`, `"reset() makes no fetch call"`.

**Do not remove** anything not on this list -- in particular, keep every
adapter-specific field-mapping/wire-format test (`eventMap`/`propertyMap`
merge behavior, GA4's `client_id`/`transaction_id`, PostHog's
`$identify`/`$groupidentify`/`$create_alias` event names, Segment's Basic
Auth header, the `flush()`/`destroy()` *ordering* tests like `"flush()
calls client.flush() and never client.shutdown()"` and `"destroy() calls
client.flush() then client.shutdown(), in that order"` -- these assert
*which* underlying method gets called in *what order*, which the generic
contract suite deliberately does not and cannot know about a specific
vendor client), the `"the adapter remains usable for a subsequent track()
call after flush() resolves (critical regression test)"` case, and every
integration test (`*.integration.test.ts`, untouched by this issue) and
SSR-safety test (`ssr-safety.test.ts`, untouched -- it exercises a
different concern, "no browser globals present", not covered by the
contract kit at all).

If, while doing this, an implementor finds an existing assertion whose
exact wording differs slightly from the list above (e.g. the repo has
drifted since this issue was written) but is clearly the same
capabilities-table/runtimes-declaration/bare-reset check, use judgment:
remove it and note the discrepancy in the commit body, rather than
treating an exact string mismatch as a reason to keep a duplicate.

## Testing

Each new `<adapter>.contract.test.ts` file itself *is* the test (it wires
the harness and calls `runProviderContractTests`) -- verify with `bun test`
that all five contract suites pass, and that each package's now-trimmed
pre-existing test file(s) still pass in full. No new integration tests
needed -- this issue reorganizes existing coverage, it does not add new
adapter behavior.

## Out of scope

Any change to the five factories' production code (`index.ts`/`fetch.ts`
in all three packages) -- this issue is test-only.
