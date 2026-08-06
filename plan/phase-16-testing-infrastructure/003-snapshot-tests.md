# 003 -- Snapshot tests: provider wire payloads + dev-server `/schema` dump

## Context

Independent of issues 001/002/004/005/006 -- can be implemented in any
order relative to them. Uses `bun:test`'s native `toMatchSnapshot()` (no
new dependency -- see `plan/phase-16-testing-infrastructure/BRIEF.md`'s
research-grounding section). Read `src/devServer/server.ts`'s
`handleGetSchema` (~line 130) and its existing `server.integration.test.ts`
before starting the second half of this issue.

Snapshot tests answer a different question than the contract kit (issue
001/002) or the per-adapter mapping tests: not "is this value correct"
(that's what an `expect(...).toEqual(...)` assertion already proves) but
"did this exact wire shape change at all since it was last locked down",
catching an accidental, unreviewed shift in a payload real downstream
systems (a provider's ingestion API, a dev-server API consumer) depend on
byte-for-byte.

## Scope of this issue

**Part A -- provider wire-payload snapshots.** For each of the five
factories (GA4, PostHog SDK, PostHog fetch, Segment SDK, Segment fetch),
add one new test file (`<adapter>.snapshot.test.ts`) that constructs a
provider (reusing that package's own existing transport-stubbing
approach, same as issue 002's contract test files), calls `track()` with
one realistic, representative canonical event per adapter (e.g. a
`"Purchase Completed"` event with `orderId`/`total`/`currency` properties
-- reuse each package's own existing default-mapped-event fixture rather
than inventing a new one), captures the exact request body/call arguments
the stubbed transport received, and asserts it with
`expect(capturedBody).toMatchSnapshot()`. One snapshot per adapter is
enough -- this is a regression lock on the *shape*, not a second copy of
issue 002's/each package's existing correctness assertions. Commit the
generated `__snapshots__/*.snap` files (standard `bun:test` convention,
same as any other checked-in fixture).

**Part B -- dev-server `/schema` dump snapshot.** Add a test (co-located
with or added to `src/devServer/server.integration.test.ts`, implementor's
call which is cleaner) that starts the dev server with a small,
representative multi-event `schemas` map (reuse an existing fixture
pattern from that file if one exists), issues a real `GET /schema`
request, and asserts the parsed JSON body with
`toMatchSnapshot()`. This locks the exact `z.toJSONSchema(schema)` output
shape the dev server currently returns -- a real consumer-facing wire
contract (anything polling `/schema`, per Phase 3's dev-server design)
that has no other regression coverage today beyond ad hoc `toEqual`
assertions against hand-written expected shapes.

## Design notes

- Snapshot values must be **fully deterministic** -- strip/normalize any
  timestamp or generated ID before snapshotting (e.g. don't snapshot
  `event.timestamp`'s literal `Date.now()`-derived value; use a fixed,
  hand-supplied timestamp in the fixture event, matching how every
  existing adapter test already does this with a literal `1_700_000_000_000`
  constant).
- Do not snapshot anything already fully pinned by an `toEqual(...)`
  assertion elsewhere with no realistic drift risk (e.g. don't add a
  redundant snapshot of GA4's `measurement_id` query param, which is
  already asserted exactly and never varies structurally) -- snapshot the
  cases where the *shape itself* (not just one field's value) is the thing
  worth locking, per this issue's Part A/B framing.

## Testing

The snapshot tests themselves are the test artifact for this issue --
running `bun test` should produce and then pass against the committed
`__snapshots__/*.snap` files. As a sanity check before finishing, run `bun
test --update-snapshots` once against a clean tree and diff the result
against what was hand-written to confirm the two match (no stray/
uncommitted snapshot content).

## Out of scope

Any snapshot of `examples/*`/`e2e/*` output -- this issue is `packages/
provider-*` and `src/devServer` only. A schema-diffing/changelog tool
(Phase 18 territory, per BRIEF.md's "Out of scope for this whole phase").
