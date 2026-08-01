# typetrack — decisions log

- **Package name**: main package is unscoped `typetrack` (root `src/`), not
  `@typetrack/core`. `import { createAnalytics } from 'typetrack'`.
- **Ecosystem packages**: provider adapters and framework wrappers are
  scoped `@typetrack/*` under `packages/`.
- **Zero vendor deps in core**: `src/` ships only the `AnalyticsProvider`
  interface (`src/providers/index.ts`) plus a local no-op provider. No
  vendor/provider SDK code lives in core, ever.
- **Single provider, not an array**: `createAnalytics` takes one optional
  `provider`, not a list of providers.
- **Monorepo**: Bun workspaces (`packages/*`). Toolchain is devDependencies
  only: Bun (install + test runner), `tsgo` (`@typescript/native-preview`,
  TS7 native port) for fast typechecking, `typescript` 6.x (`tsc`) as the
  emit/source-of-truth compiler, `oxlint` for linting, `Knip` for
  unused-code checks, `tsup` for building.

For phase planning and issue breakdowns, see `plan/`. Use the
`research-planner`, `implementor`, and `qa` subagents (`.claude/agents/`)
for phase work; commit and branching conventions are in
`.claude/skills/git-discipline/SKILL.md` — notably: commit straight to
`main`, no PRs, no lingering branches.
