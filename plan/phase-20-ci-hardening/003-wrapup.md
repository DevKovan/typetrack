# Issue 003: Wrap-up

## Why

Every phase since Phase 6 closes with a `plan/CHANGELOG.md` entry and,
where new user/contributor-facing docs were added, cross-links so they're
discoverable rather than orphaned.

## What to do

1. Write `CONTRIBUTING.md` (created by issues 001/002, one file, two
   sections: "Continuous Integration" and "Flaky-test triage").
2. Confirm README.md's "Building from source" section links to
   `CONTRIBUTING.md` (issue 001's acceptance criteria already required a
   pointer at doc-creation time — this issue just confirms it's there,
   not orphaned, and reads well end to end alongside the rest of the
   section).
3. Add a one-line Phase 20 entry to `plan/CHANGELOG.md`, following the
   existing format (see the Phase 6-19 entries for current style/length):
   summarize the trimmed scope (CI-trigger investigation + flaky-test
   triage; branch protection moved to Phase 22), the headline finding
   (13.75% silent GH Actions trigger-failure rate, GitHub-side, not
   locally fixable; one systemic flaky-test root cause found and fixed
   across 9 files, real CI unaffected), and point at
   `CONTRIBUTING.md` for the full write-up.

## Acceptance criteria

- [x] `CONTRIBUTING.md` reads coherently end to end (both sections
      present, cross-references correct).
- [x] README.md links to `CONTRIBUTING.md`.
- [x] `plan/CHANGELOG.md` has a new Phase 20 entry, matching the existing
      per-phase length/style.
- [x] Full `.github/workflows/qa.yml` step sequence passes locally one
      more time on the final state (build:all, size, e2e, lint,
      typecheck, typecheck:svelte, test, knip).
