# Phase 11 brief: privacy & consent

Read CLAUDE.md, README.md, plan/VISION.md, plan/GAP-ANALYSIS.md, and
plan/ROADMAP.md (Phase 11 section) first. Read the current src/index.ts,
src/routing.ts, src/middleware.ts, src/middleware/redact.ts, src/context.ts,
and src/plugins/autoUTM.ts in full — Phase 6 put identity/session state
(`anonymousId`/`sessionId`/`userId`) in core, in-memory only, regenerated
fresh at every `createAnalytics()` construction (core has never persisted
any identifier to a cookie or Storage API — confirmed by grep, the only
client-side persistence anywhere in `src/` is `autoUTM`'s `sessionStorage`
write). Phase 7 added per-provider routing (`shouldRouteToProvider` in
`src/routing.ts`, scoped to `track`/`page`/`screen` only — `identify`/
`group`/`alias` always fan out unconditionally, a deliberate Phase 7
decision this phase partially revisits for consent reasons, see issue 005).
Phase 8 added the `.use()` middleware pipeline and the existing
`redactMiddleware` (exact-dotted-path allowlist redaction, opt-in). Note
`src/index.ts`'s `Analytics` interface already carries this comment,
written at Phase 6 time and never revisited since:

> `enable()`/`disable()` (privacy/consent gating) are intentionally not
> part of this interface yet -- deferred to the Privacy/consent phase.

This phase fills that reserved slot, plus the richer category-based consent
model, anonymous mode, cookieless mode, provider-aware gating, and PII
pattern-based filtering named in `plan/ROADMAP.md`'s Phase 11 line. This
phase builds directly on top of Phases 6-10; do not re-litigate their
design.

## Scope (from plan/ROADMAP.md), mapped to issues

- **Consent API** → issues 001, 002, 003.
- **GDPR/CCPA support** → issue 001 (Do Not Track / Global Privacy Control
  detection), issue 002 (fail-closed `defaultState` posture +
  `respectBrowserSignals` wiring — the same primitive supports both GDPR's
  opt-in posture and CCPA/CPRA's opt-out-with-GPC posture via config, not
  two separate code paths).
- **Anonymous mode** → issue 004.
- **Cookie-less mode** → issue 006.
- **PII filtering/redaction** → issue 007 (new pattern-based
  `piiFilterMiddleware`, complementing — not replacing — Phase 8's existing
  exact-path `redactMiddleware`).
- **Provider-aware consent gating** → issue 005.
- **Examples**: `examples/recipes/` → issue 008.

## Research grounding (informed the design, not vendor deps in core)

Reviewed how Segment, RudderStack, and PostHog model consent (see
`@segment/consent-manager`, RudderStack's `context.consentManagement`
category-ID model with per-destination gating, PostHog's
`opt_out_capturing`/`cookieless_mode`). None of that code or any vendor
dependency enters `src/` — per CLAUDE.md's "zero vendor deps in core" rule,
this phase's consent primitives are plain, provider-agnostic core
constructs (`ConsentCategory` is a freeform `string`, not tied to any
vendor's taxonomy); provider-*specific* consent-mode integrations (e.g. GA4
Consent Mode v2's `gtag('consent', ...)`) are explicitly out of scope for
this phase — see "Out of scope" below.

## Design decisions locked for this phase

No interactive `grill-me` session was available in the planning pass that
produced these issue files (the planning subagent had no skill-invocation
or user-interaction tool in that session) — the decisions below were
resolved by combining the industry research above with strict consistency
against this repo's own established precedents (Phase 6's verb-scoping,
Phase 7's routing/capability-gating patterns, Phase 8's middleware
short-circuit conventions, Phase 9/10's "omitted option = byte-for-byte
unchanged behavior" convention). They are written up per-issue as "locked
design" sections, exactly as Phase 10's issue 001 did after its own
grill-me. If the user disagrees with any of these before/during
implementation, they supersede this document — flag and resolve via
grill-me at that point rather than treating this as unchangeable.

1. **Two independent gates, not one.** `enable()`/`disable()` (issue 003)
   is a coarse, categoryless kill switch — the VISION.md-reserved verb
   pair, default enabled, matching every other SDK's `optOut`/
   `opt_out_capturing`-style pause switch. `consent` (issues 001-002) is a
   category-based model for actual legal consent state. The two compose
   (both AND'd together) but are never conflated: `disable()` does not
   touch consent state, denying a consent category does not flip
   `enabled`, and neither is reset by `reset()` (identity/session reset is
   not a privacy-state reset — a logout should not silently re-enable
   tracking that was explicitly disabled, nor erase a consent decision the
   visitor already made for this browser session).
2. **Consent categories are freeform strings**, not a fixed enum —
   different legal regimes and CMPs use different taxonomies
   (`"necessary"/"analytics"/"marketing"/"functional"` is a documented
   convention, not an enforced type) — matches RudderStack's freeform
   category-ID model rather than inventing a fixed vocabulary typetrack
   would have to maintain.
3. **Consent state is always live on `Analytics`, gating is opt-in.**
   `analytics.consent` (grant/deny/hasConsent/get) exists on every
   instance regardless of whether `createAnalytics({ consent })` was
   configured at all — so `ProviderEntry.requiresConsent` (issue 005) can
   reference categories independently of whether a *global* gate
   (`requiredCategories`) exists. The global gate itself is opt-in
   (`consent` option omitted entirely ⇒ zero behavior change from
   pre-Phase-11, matching every prior phase's convention).
4. **Fail closed by default.** When the `consent` option is supplied at
   all, `defaultState` defaults to `"denied"` (a category never explicitly
   granted/denied is treated as not consented) — the GDPR-correct posture.
   An app targeting CCPA/CPRA's opt-out model sets `defaultState: "granted"`
   explicitly and pairs it with `respectBrowserSignals: true` to honor
   Global Privacy Control as the opt-out signal — same primitive, two
   documented postures.
5. **typetrack does not persist consent decisions itself.** No cookie, no
   localStorage, no sessionStorage write for consent state, ever — mirrors
   the pre-existing (and, per issue 006, now-locked-and-tested) fact that
   core never persists identity either. An app that wants a consent choice
   to survive a page reload persists `analytics.consent.get()`'s snapshot
   itself (in its own CMP/cookie/localStorage) and re-supplies it via
   `consent.initialState` on the next `createAnalytics()` call.
6. **Consent/enabled gating runs before everything else**, including
   `track()`'s existing dev-server mirror POST — a gated-off call must
   produce zero observable side effects, full stop, not just "no provider
   call." This is a documented behavior change to `track()`'s previously
   unconditional dev-server-mirror timing (see issue 002).

## Process

Same as every phase since Phase 6:

1. Write issue files into `plan/phase-11-privacy-consent/`. **Issue files
   are kept, never deleted** (standing policy — see plan/ROADMAP.md
   "Policy changes"). Per the "research-planner hangs" memory note, this
   phase's issue files were written directly rather than via the
   `research-planner` subagent.
2. For each issue: `implementor` subagent implements with unit+integration
   tests, `qa` subagent checks it, loop until pass.
3. Commit per `.claude/skills/git-discipline/SKILL.md` exactly — plain
   subject, no Conventional Commits prefix, no Co-Authored-By, body
   references the issue file path.

## Branching / landing

Branch `phase-11-privacy-consent` for isolation. Once all issues pass QA:
push commits to `origin/main` directly (no PR, no force-push — if
`origin/main` has moved, rebase cleanly on top). Delete the
`phase-11-privacy-consent` branch (local, and remote only if pushed there).
Do **not** delete `plan/phase-11-privacy-consent/` issue files. Add a
one-line Phase 11 entry to `plan/CHANGELOG.md` following the existing
format (see the Phase 6-10 entries for the current style/length).

**STOP AFTER THIS PHASE.** Do not start any further phase, do not pick new
work. Report back and go idle once this phase's commits are on main and
cleanup is done.

## Out of scope for this whole phase

- Vendor-specific Consent Mode integrations in `packages/provider-{ga4,
  posthog,segment}` (e.g. GA4 Consent Mode v2's `gtag('consent', ...)`) —
  this phase's gating is entirely core-side (whether a provider is called
  at all); teaching individual adapters to also forward consent state
  *into* the vendor's own consent API is real, adapter-specific work
  deferred to a future phase.
- Any persistence of consent decisions across page loads by typetrack
  itself (no cookie/localStorage/sessionStorage write for consent, ever) —
  the app's responsibility, see design decision 5 above.
- Value-content PII scanning (regex over string *values*, e.g. detecting an
  email-shaped string under an unexpected key name) — issue 007 is
  key-name-pattern-only; value-shape detection is real, separate scope,
  explicitly deferred.
- A cookie-consent-banner UI component — typetrack is a headless SDK; the
  banner/CMP is the app's (or a third-party CMP's) job, typetrack only
  exposes the `analytics.consent` primitives a banner would call into.
- IP-based or daily-rotating ephemeral anonymous IDs (PostHog-style
  cookieless server-side hashing) — typetrack's cookieless mode (issue 006)
  means "never persist an identifier client-side," not "rotate identifiers
  via server-side IP hashing" (a browser SDK has no server-side IP access
  to do this with anyway).
- Right-to-erasure / data-subject-access-request tooling (warehouse
  deletion workflows, etc.) — already listed under VISION.md's "Future
  investigation," stays there.
- Extending `Middleware.before()`/`.after()` with a consent-reading context
  parameter — not needed given issues 002/003/005's dispatch-layer gate
  design; an app middleware that genuinely needs live consent state can
  close over the same `analytics` instance it already has a reference to.

## Done criteria

Before declaring done, verify from a genuinely clean checkout:
`rm -rf node_modules dist packages/*/dist 2>/dev/null; rm -rf
packages/*/node_modules 2>/dev/null`, `bun install`, `bun run build:all`,
`bun run lint`, `bun run typecheck`, `bun test`, `bunx knip` — all must
pass. Report back: issues completed, the final consent/enable/anonymous/
cookieless shapes landed, how provider-aware gating composes with Phase 7's
routing, files changed, and clean-checkout verification results.
