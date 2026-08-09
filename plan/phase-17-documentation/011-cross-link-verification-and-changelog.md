# 011 -- Cross-link verification, final QA pass, changelog

## Context

Last issue in this phase -- depends on every other issue (001-010) already
being merged to `main`. This issue adds no new guide content of its own; it
verifies what the previous ten issues shipped is internally consistent and
records the phase in `plan/CHANGELOG.md`.

## Scope of this issue

1. **Link verification**: for every `docs/*.md` file (including `docs/
   providers/*.md`), check every Markdown link (`[text](path)` or
   `[text](path#anchor)`) that points at another file in this repo actually
   resolves -- the target file exists, and if an anchor is given, a heading
   in the target file actually produces that anchor (GitHub's own
   heading-to-anchor slugification: lowercase, spaces→hyphens, punctuation
   stripped). Fix any broken link found (either the link or the missing
   heading, whichever is the actual mistake) rather than silently leaving
   it and reporting it as a known gap.
2. **Citation verification**: for every code sample across all ten guides
   that (per BRIEF.md Design decision 3) claims to be copied verbatim from a
   real source with an inline citation comment, re-read the cited file/
   symbol and confirm the sample still matches it exactly (docs written
   across issues 002-010 could have drifted from a source file touched by a
   different, concurrently-running issue, or simply been transcribed with a
   small error) -- fix any mismatch found. For samples labeled illustrative
   pseudo-code, confirm they're actually labeled as such (no unlabeled
   invented code presented as if it were real, working typetrack code).
3. **`docs/README.md` completeness check**: confirm every guide issues
   001-010 actually shipped is linked from the index, and that the index's
   one-line descriptions still match each guide's real, final content
   (a description drafted in issue 001 before issue 008/009's content
   existed may need a small wording adjustment).
4. **Root `README.md` sanity check**: confirm its `## Documentation` link
   (added in issue 001) still resolves, and its `## Usage` sample still
   matches `src/index.ts`/`src/providers/index.ts`'s real current exported
   signatures (re-verify, don't assume issue 001's read is still accurate
   if any of these files changed since -- unlikely within one phase, but
   cheap to confirm).
5. **Full clean-checkout verification**, mirroring every prior phase's own
   "Done criteria" and this repo's standing instruction to run the same
   checks locally before every push -- from a genuinely clean checkout:
   `rm -rf node_modules dist packages/*/dist packages/*/node_modules
   examples/*/*/node_modules e2e/node_modules 2>/dev/null`, `bun install`,
   `bun run build:all`, `bun run size`, `bunx playwright install --with-deps
   chromium && cd e2e && bun run test && cd ..`, `bun run lint`, `bun run
   typecheck` (root, plus `cd packages/svelte && bun run typecheck:svelte`),
   `bun test --conditions=browser --path-ignore-patterns='e2e/**'`, `bunx
   knip` -- all must pass. This confirms the whole Markdown-only phase
   genuinely didn't regress anything, matching `.github/workflows/qa.yml`'s
   own step order exactly.
6. **`plan/CHANGELOG.md`**: add a one-line Phase 17 entry, following the
   existing format (see the Phase 6-16 entries for current style/length).
   Cover: the new top-level `docs/` directory and its ten guides
   (architecture, cookbook, migration, three per-provider guides, plugins,
   middleware, performance, comparison, FAQ); the root `README.md` refresh
   (name the specific staleness fixed -- the pre-Phase-6 `track()` call
   shape and the "Early scaffold" status line); and the corrected pipeline-
   order finding from this phase's own BRIEF.md ("A stale-vision
   correction" -- `plan/VISION.md`'s aspirational pipeline diagram doesn't
   match the real, shipped `track()` order; `docs/architecture.md`
   documents the real one). Per policy, this phase's issue files stay in
   `plan/phase-17-documentation/` permanently.

## Testing

This issue *is* the testing pass for the whole phase -- see Scope items 1-5
above. No separate test section beyond what's already specified there.

## Out of scope

Writing any new guide content -- if a genuine content gap is found during
verification (not just a broken link/stale citation), fix it minimally in
place rather than scoping a new issue for it (this phase is small enough
that a real gap found this late is cheaper to patch directly than to spin
up issue 012 for).

## Done criteria (for the phase as a whole)

Before declaring Phase 17 done: every issue 001-011 committed to `main`
individually (per this repo's one-commit-per-issue convention), the clean-
checkout verification above passes, `plan/CHANGELOG.md` has its Phase 17
entry, and no isolation branch is left over (per BRIEF.md's "Branching /
landing" section, this phase committed straight to `main` throughout, so
there should be nothing to delete).
