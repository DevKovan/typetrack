---
name: git-discipline
description: Commit and branching conventions for the typetrack repo — one commit per issue, plain commit subjects (no Conventional Commits prefix), no Co-Authored-By trailer, commit straight to main, no PRs, no lingering branches.
---

This is a deliberate departure from Claude Code's default git behavior,
which tends toward PR-per-task, auto-generated branch names, and
Conventional Commits-style `type(scope): summary` prefixes. None of that
applies in this repo. Follow the rules below instead, and don't fall back
to default habits mid-task.

## Commits

- One commit per issue by default. Split further only if an issue's diff
  spans genuinely unrelated concerns.
- Plain imperative subject line, no `type(scope):` prefix (e.g. "Add event
  schema validation", not "feat(schema): add event schema validation").
- Commit body references the issue file path (e.g. `plan/phase-1-x/003-y.md`),
  not a GitHub issue number.
- Never add a `Co-Authored-By` trailer, for any commit, no exceptions — must
  be explicitly suppressed rather than left to default agent behavior.
- No unrelated formatting-only diffs bundled into a feature commit.

## Branching

- Default to committing directly on `main`. Do not create a branch unless
  doing a real, multi-commit phase of work that needs isolation.
- No pull requests, ever, unless explicitly asked. Push straight to `main`.
- No throwaway agent/session branches (e.g. `ao/<session-id>/root`-style)
  surviving past the work. If a branch was needed, delete it — local and
  remote — once it's merged or pushed to `main`.
