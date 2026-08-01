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
- **Cross-package deps**: sibling-to-sibling deps between true `packages/*`
  workspace members (e.g. `packages/next`'s dep on `@typetrack/react`) use
  the `workspace:*` protocol, not `file:` — `workspace:*` is rewritten to
  the real resolved version at publish time, and empirically materializes
  as a live symlink to the sibling's directory (survives `dist/` being
  deleted/recreated by `tsup`'s `clean: true`). The root `typetrack`
  package cannot be depended on this way, though: Bun only resolves
  `workspace:*` for packages matched by the `workspaces` glob
  (`packages/*`), and the monorepo root isn't itself a glob member (this
  was verified empirically — `workspace:*` install fails outright for it).
  So `packages/react`, `packages/next`, and `packages/provider-*` still
  depend on root `typetrack` via `file:../..`.
- **Build orchestration**: `bun run build:all` (root `package.json`) is the
  one command that builds every package in the required dependency order
  (root `typetrack`, then `packages/react`, then `packages/next`) — CI
  (`.github/workflows/qa.yml`) uses exactly that command. It also re-runs
  `bun install` once after the root build, because `typetrack`'s `file:`
  dep is a point-in-time snapshot taken at install time (not a live link),
  and `tsup`'s `clean: true` on the root build means that snapshot has to
  be refreshed before `packages/react`'s `tsup --dts` build (which
  re-exports types from `typetrack`) can resolve it.

For phase planning and issue breakdowns, see `plan/`. Use the
`research-planner`, `implementor`, and `qa` subagents (`.claude/agents/`)
for phase work; commit and branching conventions are in
`.claude/skills/git-discipline/SKILL.md` — notably: commit straight to
`main`, no PRs, no lingering branches.
