# Issue 006: feed real numbers into docs + wrap-up

## Context

Read `plan/phase-19-performance-benchmarking/BRIEF.md` in full. Read
issues 002-005's landed results files (`benchmarks/results/*.md`) — this
issue's entire job is transcribing those real, already-measured numbers
into the two docs pages that currently only have prose/stub-sentence
placeholders: `docs/performance.md` and `docs/comparison.md`. Read both of
those files in full before editing (already read once during this phase's
planning — re-read for the exact current stub-sentence wording to replace).
Also read `docs/README.md`'s cross-link list (Phase 17 convention: every
guide is cross-linked from the README index) to add `benchmarks/README.md`
appropriately if warranted, and `plan/CHANGELOG.md`'s existing per-phase
entry format/length (Phase 6-18 entries) to match style.

Depends on issues 002-005 all being landed with real results files.

## Scope

1. `docs/performance.md`:
   - Replace the "What's measured today, and where" section's dispatch-
     overhead paragraph to also link/cite the new `benchmarks/results/
     internal.md` (issue 002) — the *comparative-across-config* numbers
     (cold start/throughput/memory per feature), presented as a real table,
     not just the existing single regression-smoke-test sentence (which
     stays, since `src/index.performance.test.ts` still exists and is still
     accurately described by that sentence — this issue adds to that
     section, it doesn't remove the accurate existing content).
   - Replace the "Bundle size" section's table with real, current numbers
     (issue 003's `benchmarks/results/bundle-size.md`) if they differ from
     what's currently hand-written there (they may not — the existing table
     shows *budget* limits, not measured sizes; consider adding a second
     column or a short note distinguishing "budget" from "actually
     measured, gzip" so both stay legible, sourced from
     `benchmarks/results/bundle-size.md`).
   - Replace the sentence "Comparative numbers against PostHog/Segment/
     RudderStack's own SDK bundle sizes, cold start, memory, and throughput
     are not published here — that's Phase 19's job... not yet landed as of
     this guide" with a real section presenting those numbers (tables from
     `benchmarks/results/bundle-size.md`, `benchmarks/results/
     tree-shaking.md`, `benchmarks/results/cold-start-memory.md`,
     `benchmarks/results/throughput.md`), each with a one-line methodology
     note and a link to the full results file (which itself carries the
     full fairness-caveats section — don't duplicate that whole section
     into the doc page, summarize it in 1-2 sentences and link out, per
     this repo's existing docs-cross-linking convention rather than
     inlining everything).
   - Update the "What's free when unused" (tree-shaking) section similarly
     — replace the qualitative claim with the real measured percentage from
     `benchmarks/results/tree-shaking.md`.
2. `docs/comparison.md`:
   - Fill in the "Bundle size / performance" row of the capability table
     with a real summary (e.g. "typetrack core: N KB gzip vs. PostHog M KB,
     Segment P KB, RudderStack Q KB — see docs/performance.md") instead of
     "Not compared numerically here" ×3.
   - Replace the paragraph "A numeric, apples-to-apples bundle-size/
     cold-start/memory/throughput comparison against these three vendors'
     own SDKs is Phase 19's job... not yet published. Don't infer a number
     from this page" with a real, brief pointer to `docs/performance.md`'s
     now-real numbers (this page stays qualitative/capability-focused per
     its own stated purpose — it should link out for the actual numbers,
     not duplicate the full tables).
3. `docs/README.md`: add a link to `benchmarks/README.md` if the existing
   cross-link index has a natural slot for "how to reproduce these numbers
   yourself" (check the existing index's structure/sections before deciding
   where it fits, or whether `docs/performance.md`'s own inline links to
   `benchmarks/results/*.md` already cover this adequately without a
   separate top-level README entry).
4. `plan/CHANGELOG.md`: add a one-line Phase 19 entry matching the
   existing Phase 6-18 entries' format/length exactly.

## Explicitly not in this issue

- Any change to `benchmarks/` itself — this issue only reads its already-
  committed results files, it does not re-run or regenerate them.
- Any change to `docs/architecture.md`, `docs/cookbook.md`, or any other
  Phase 17 doc not named above.

## Acceptance criteria

- `docs/performance.md` and `docs/comparison.md` contain real numbers
  transcribed from `benchmarks/results/*.md`, with no remaining "not yet
  published"/"Phase 19's job, not yet landed" placeholder language.
- Every new number in both docs pages traces back to a specific
  `benchmarks/results/*.md` file, linked, not invented inline.
- `plan/CHANGELOG.md` has a new Phase 19 entry.
- Full `.github/workflows/qa.yml` step sequence passes locally on a clean
  checkout (build:all, size, e2e, lint, typecheck, typecheck:svelte, test,
  knip) — this is the final issue of the phase, so this is the last full
  verification before landing on `main`.
