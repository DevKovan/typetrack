# Phase 12 brief: reliability

Read CLAUDE.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and plan/ROADMAP.md
(Phase 12 section) first. Read the current src/index.ts in full — in
particular `callSingleProvider` (the single-provider fast-path failure
handler) and `dispatchToProviders`/`settleAll` (the multi-provider fan-out
failure handlers): today, a provider `track`/`page`/`screen` call that
throws or rejects is `console.warn`ed, reported to middleware `onError`,
and then **the event is permanently lost** — there is no retry, no
persistence, no offline awareness anywhere in the codebase. This phase
builds that reliability layer on top. Also read src/schema.ts
(`CanonicalEvent`, `TrackOptions`), src/providers/index.ts
(`AnalyticsProvider`, `ProviderCapabilities` — the existing
capability-gating pattern this phase's batching support extends), and
src/context.ts (`isBrowserEnvironment`, and its try/catch-never-throw
convention for touching browser globals — this phase's storage adapters
and unload listener must follow the same convention).

This phase builds directly on top of Phases 6-11; do not re-litigate their
design. In particular: Phase 11's consent/`enabled` gate already runs
before any provider dispatch is attempted — a gated-off call never reaches
this phase's queue at all, so no interaction with consent is needed here.

## Scope (from plan/ROADMAP.md), mapped to issues

- **Offline queue (IndexedDB → localStorage → memory fallback chain)** →
  issues 001 (storage adapters), 002 (queue engine), 003 (wiring).
- **`sendBeacon`** → issue 006 (flush-on-unload).
- **Retries/backoff** → issues 002 (backoff computation), 003 (wiring to
  the real provider-failure path).
- **Batching** → issue 005.
- **Priority queue** → issue 004.
- **Flush-on-unload** → issue 006.
- **Examples**: `examples/advanced/` → issue 007.

## Scope boundary: `track`/`page`/`screen` only

`identify`/`group`/`alias` have no `CanonicalEvent` (Phase 6's identity
verbs dispatch raw arguments directly to each provider, per the existing
comment at src/index.ts's `Analytics` interface: "`identify`/`group`/
`alias`/`reset`/`flush`/`destroy` have no `CanonicalEvent`"). A
JSON-serializable, replayable queue entry requires a `CanonicalEvent` (or
an equally serializable payload) — `track`/`page`/`screen` are the only
three verbs that produce one. This phase's queue, retry, batching, and
priority mechanisms apply to those three verbs only. `identify`/`group`/
`alias` keep today's behavior unchanged: a failed call is still just
`console.warn`ed and lost, exactly as before this phase. This mirrors
Phase 7's precedent of `identify`/`group`/`alias` being deliberately
out-of-scope for routing, and Phase 11 issue 005's precedent of extending
only a narrow slice of new machinery to those three verbs rather than
their full routing/queueing surface.

## Design decisions locked for this phase

No interactive `grill-me` session was available when this plan was
written — these decisions were resolved by combining how Segment,
RudderStack, and PostHog's browser SDKs implement offline/retry queues
(bounded local queue, exponential backoff, `sendBeacon` on unload) with
strict consistency against this repo's own established precedents
(Phase 6's `devServer?: boolean | { url }` shorthand-or-object option
shape, Phase 9's storage-touching try/catch-never-throw convention, Phase
11's `consent`/`enable` controller-object pattern for `analytics.consent`,
Phase 6's `ProviderCapabilities` capability-gating pattern). If the user
disagrees with any of these before/during implementation, they supersede
this document — flag and resolve via grill-me at that point.

1. **Fully opt-in, boolean-or-object shorthand.** `reliability?: boolean |
   ReliabilityOptions` on `CreateAnalyticsOptions`, mirroring `devServer`'s
   existing shape exactly. Omitted entirely ⇒ zero behavior change from
   pre-Phase-12: a failed provider call is still `console.warn`ed +
   `onError`-notified + swallowed, no queue, no persistence, no retry.
   `true` ⇒ every `ReliabilityOptions` field takes its documented default.
2. **Two independent enqueue triggers, both opt-in-gated by the same
   `reliability` option.** (a) **Proactive offline**: in a browser
   environment, if `navigator.onLine === false` at dispatch time, the
   provider call is never attempted at all — the event is enqueued
   directly (avoids a doomed network round-trip). (b) **Reactive
   failure**: a provider call is attempted normally; if it throws/rejects,
   the event is enqueued for retry instead of being dropped. Both paths
   converge on the same queue engine (issue 002) and the same per-provider
   entry shape.
3. **Queue entries are per (event, provider), not per event.** In a
   multi-provider fan-out, each provider's failure/offline-skip is
   enqueued independently, keyed by `provider.name` (already a required,
   presumed-stable field on `AnalyticsProvider` per every existing
   adapter) — a retry only re-attempts the specific provider(s) that
   originally failed, not the full fan-out list. At drain time, the
   provider is looked up live in the current `normalized.entries` by
   name; if a previously-configured provider is no longer present (e.g.
   the app reconstructed `Analytics` with a different provider list — rare
   given `Analytics` instances aren't normally rebuilt), that entry's
   queued events are dropped with a `console.warn`, not silently retried
   forever against nothing.
4. **Whole-array persistence, not incremental.** Given `maxQueueSize`'s
   modest default (100) and purpose (bridge brief offline gaps and
   transient failures, not a durable event warehouse), each storage
   adapter's `save()` overwrites the entire persisted queue on every
   mutation — O(n) per save, deliberately simple and always consistent,
   not a performance-optimized incremental-diff path. Document this
   explicitly as an intentional simplicity tradeoff.
5. **Dead-letter on exhaustion, not infinite retry.** `maxAttempts`
   (default 5) bounds retries per entry; exhausting it drops the entry
   with a `console.warn` naming the provider and event. No separate
   dead-letter store — typetrack does not become a durable event log.
6. **Bounded queue, drop-oldest-lowest-priority on overflow.** Exceeding
   `maxQueueSize` evicts the lowest-priority, then oldest, entry to make
   room for the new one (never rejects/throws on enqueue) — a queue is a
   bounded buffer for transient conditions, not something an app-level
   flood should be able to grow unbounded via storage.
7. **`analytics.queue` is always present on `Analytics`** (mirroring Phase
   11's `analytics.consent` always-present precedent), independent of
   whether `reliability` was configured — `{ size(): number; drain():
   Promise<void>; clear(): void }`. When `reliability` is omitted, `size()`
   is always `0` and `drain()`/`clear()` are no-ops (there is never
   anything to queue) — this keeps the surface uniform rather than
   `consent`-style-optional.
8. **`flush()` drains the reliability queue too.** `flush()`'s existing
   contract (call every provider's `flush()`) is extended to also attempt
   an immediate queue drain first (retry every queued entry once,
   regardless of backoff schedule — an explicit `flush()` call is the
   app's signal that "now is a good time to try," not something that
   should wait out a backoff timer). `destroy()` does **not** auto-drain
   the queue (an app tearing down isn't necessarily online/able to
   flush — draining on `destroy()` would silently attempt network calls
   during teardown); `destroy()` does stop the background drain timer and
   unload listener cleanly, leaving any still-queued entries in storage
   (a future `createAnalytics()` construction against the same storage
   picks them back up, per decision 9).
9. **Persisted queue entries survive across `Analytics` instances** (the
   whole point of "offline queue" surviving a page reload) — at
   construction time, if `reliability` is enabled, the queue engine
   hydrates any entries already present in the resolved storage adapter
   (best-effort; a corrupt/unparseable persisted blob is discarded with a
   `console.warn`, not thrown).

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-12-reliability/`. **Issue files are
   kept, never deleted** (standing policy — see plan/ROADMAP.md "Policy
   changes").
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-12-reliability` for isolation. Once all issues pass QA: push
commits to `origin/main` directly (no PR, no force-push — if
`origin/main` has moved, rebase cleanly on top). Delete the
`phase-12-reliability` branch (local, and remote only if pushed there). Do
**not** delete `plan/phase-12-reliability/` issue files. Add a one-line
Phase 12 entry to `plan/CHANGELOG.md` following the existing format (see
the Phase 6-11 entries for the current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Out of scope for this whole phase

- Queueing/retrying `identify`/`group`/`alias` — see "Scope boundary"
  above.
- A durable/unbounded event log or dead-letter store — exhausted entries
  are dropped, not archived (decision 5).
- Server-side/Node queue persistence (e.g. a filesystem-backed adapter) —
  the storage fallback chain is browser-oriented
  (IndexedDB/localStorage/memory); a non-browser environment always
  resolves to the in-memory adapter, which does not survive process
  restarts — documented, not a gap this phase fixes.
- Cross-tab queue coordination/deduplication (e.g. two open tabs both
  draining the same persisted queue and double-sending) — each
  `Analytics` instance owns its own drain loop independently; the existing
  storage APIs (`localStorage`, IndexedDB) are shared across tabs, so two
  tabs draining concurrently is a known, accepted limitation, not solved
  here.
- Compression or size-limiting of individual persisted event payloads.
- Configurable retry policies beyond exponential backoff (e.g. linear,
  jittered — jitter specifically may be worth a follow-up, but a plain
  exponential schedule is this phase's scope).
- Wiring `reliability` into any provider adapter (`packages/provider-*`) —
  this phase's queue lives entirely in core; adapters are unaware their
  `track()` call may be a retry.

## Done criteria

Before declaring done, verify from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist 2>/dev/null; rm -rf
packages/*/node_modules 2>/dev/null`, `bun install`, `bun run build:all`,
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip` — all must
pass. Report back: issues completed, the final `reliability`/`queue`
shapes landed, how batching composes with `ProviderCapabilities`, files
changed, and clean-checkout verification results.
