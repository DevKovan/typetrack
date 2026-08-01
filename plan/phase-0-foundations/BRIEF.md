# Phase 0 brief: repo scaffold + toolchain + CI

Bun workspace monorepo for `typetrack`, a typed zero-runtime-cost analytics SDK.

## Branching / commits

Work directly on this branch (the initial setup branch) — do NOT create a phase-N
branch for this work, do NOT open a PR, just commit here directly. Git identity
(user.name=DevKovan, user.email=devkovan13@gmail.com) and remote
(git@github-devkovan:DevKovan/typetrack.git via SSH) are already configured —
do not touch git config or remote. Never add a `Co-Authored-By` trailer to any
commit (see clean-commits skill below, no exceptions). Push to origin (this
branch tracks origin/main) when done — no PR.

## Naming decisions (resolved, do not relitigate)

- Main package is unscoped `typetrack` (root `src/`), not `@typetrack/core`.
  `import { createAnalytics } from 'typetrack'`.
- Ecosystem packages (provider adapters, framework wrappers) are scoped
  `@typetrack/*` under `packages/`.
- Core has zero vendor/provider dependencies. `createAnalytics` takes one
  optional `provider` (not an array).

## Repo structure to scaffold

```
typetrack/
├── .claude/
│   ├── agents/
│   │   ├── research-planner.md
│   │   ├── implementor.md
│   │   └── qa.md
│   ├── skills/
│   │   └── clean-commits/
│   │       └── SKILL.md
│   └── settings.json
├── plan/
│   └── phase-0-foundations/   (this file lives here; leave it, or fold key points into CLAUDE.md and delete once done)
├── src/
│   ├── index.ts
│   ├── schema.ts
│   ├── devServer/
│   ├── providers/
│   └── cli/
├── packages/
│   ├── provider-posthog/
│   ├── provider-segment/
│   └── provider-ga4/
├── .github/workflows/
│   └── qa.yml
├── tsup.config.ts
├── knip.json
├── package.json
├── CLAUDE.md
└── README.md
```

## Toolchain

devDependencies only, never runtime deps of the shipped package:
- Bun: install + test runner
- `tsgo` (TypeScript 7) for fast typechecking, alongside `tsc`/TypeScript 6.x
  as source of truth for emit
- `oxlint` for linting
- `Knip` for unused deps/exports/files — `knip.json` entry point `src/index.ts`,
  mark public API exports so Knip doesn't flag them
- `tsup` for building

Research current versions/APIs of tsgo, oxlint, and Knip before pinning
versions — these move fast, don't rely on stale training data.

`package.json` at root: Bun workspaces (`packages/*`), scripts for
lint/typecheck/test/build, `exports` map placeholder on the `typetrack`
package (Phase 4 fills it out properly, just needs something sane now).

## Provider adapter interface

Put in `src/providers/`. Core ships only this interface + a local no-op
provider — no vendor code yet.

```ts
interface AnalyticsProvider {
  name: string;
  init?(config: Record<string, unknown>): void | Promise<void>;
  track(event: string, payload: Record<string, unknown>, meta: EventMeta): void | Promise<void>;
  identify?(userId: string, traits?: Record<string, unknown>): void | Promise<void>;
  page?(name?: string, props?: Record<string, unknown>): void | Promise<void>;
  flush?(): Promise<void>;
}
```

## Subagents (`.claude/agents/*.md`)

### `research-planner.md`
Frontmatter: `tools: WebSearch, WebFetch, Read, Grep, Glob`, `model: sonnet`.
description: "Use at the start of every phase, and whenever an issue's scope
is unclear, to research current library versions/APIs and produce a clean,
scoped implementation plan broken into small issues before any code is
written."
Body: research anything version/API-sensitive before planning. Decompose the
phase goal into issues small enough to land as one focused commit each. Write
each issue as `plan/phase-N-<name>/NNN-<slug>.md` with sections: Context,
Acceptance criteria, Test requirements (must specify both unit AND
integration test expectations — no issue is done without both), Out of
scope. Never write implementation code. Output the list of created issue
file paths and stop.

### `implementor.md`
Frontmatter: `tools: Read, Edit, Write, Bash, Grep, Glob`, `model: sonnet`.
description: "Use to implement exactly one issue file from plan/. Writes the
code plus unit and integration tests for that issue, and nothing outside its
scope."
Body: read the single issue file given in the prompt, implement only what's
in its acceptance criteria, write both unit tests (isolated logic) and
integration tests (e.g. actual HTTP round-trip, actual Zod validation
against a real schema) — both required per issue. Run the test suite locally
before returning. Don't touch files unrelated to the issue. Return a summary
of files changed and why.

### `qa.md`
Frontmatter: `tools: Bash, Read, Grep, Glob`, `model: haiku`.
description: "Use after the implementor finishes an issue, to run lint,
typecheck, unit+integration tests, and unused-code checks, and verify the
diff actually satisfies the issue's acceptance criteria. Read-only."
Body: run oxlint, `tsgo --noEmit` (or `tsc --noEmit` fallback), `bun test`,
`bunx knip`. Re-read the issue's acceptance criteria and check the diff
against each item explicitly, one line per criterion: pass/fail. Never edit
source. Output a single structured pass/fail report; on fail, state exactly
which command/criterion failed and why.

## Commit skill (`.claude/skills/clean-commits/SKILL.md`)

- One commit per issue by default; split further only if an issue's diff
  spans genuinely unrelated concerns.
- Conventional commit format: `type(scope): summary`.
- Commit body references the issue file path, not a GitHub issue number.
- No `Co-Authored-By` trailer ever — must be explicitly suppressed for every
  commit, not left to default agent behavior.
- No unrelated formatting-only diffs bundled into a feature commit.

## CI (`.github/workflows/qa.yml`)

Triggers: `pull_request` and `push` to `main`. Steps: `bun install`,
`oxlint`, `tsgo --noEmit` (or `tsc` fallback), `bun test`, `bunx knip`.

## CLAUDE.md

Short decisions log at repo root recording: unscoped main package name,
single-provider (not array) design, zero-vendor-deps core rule, Bun
workspace monorepo structure, pointer for future sessions. Keep it short,
not a tutorial.

## README.md

Brief project description, install/usage sketch — can be minimal/placeholder
now, fleshed out later.

## Done criteria

After scaffolding, run whatever local checks are feasible (bun install,
lint, typecheck) to confirm the toolchain actually works end to end, fix
anything broken. Commit per clean-commits rules above, then push directly to
origin (no PR). Report back a summary of what was created and the toolchain
check results.
