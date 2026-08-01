# 002 — `@typetrack/next`: `"use client"` boundary wrapper around `AnalyticsProvider`

## Context

Depends on issue 001 (`@typetrack/react`) being complete.

Current stable Next.js is 16.x (React 19.2 under the App Router), and the
App Router's Server Components (the default for every file under `app/`
that isn't explicitly marked otherwise) cannot use React Context directly:
a Context object/Provider can only be instantiated from a Client Component.
Research confirms the standard, effectively mandatory pattern: a small
file marked with the `"use client"` directive (which must be the file's
very first line, before any imports) that defines/re-exports the
Provider, so that Server Component layouts/pages (e.g. a typical
`app/layout.tsx`) can import and render it without themselves needing to
become a Client Component. Comparable published packages
(`@vercel/analytics`'s `/next` sub-export, PostHog's Next.js integration
docs) ship exactly this: a pre-marked `"use client"` component, not a
documentation-only pattern — so this is genuine, needed library code, not
an unnecessary abstraction.

This package is deliberately thin: it exists only to supply the
`"use client"` boundary that `@typetrack/react`'s `AnalyticsProvider`
itself cannot carry (a boundary directive is meaningless/unnecessary in a
plain React app with no server/client component split — it belongs in the
Next.js-specific package, not in `@typetrack/react`).

**Hook re-export note**: only `AnalyticsProvider` (a component that renders
JSX using a Context) requires the `"use client"` directive. `useAnalytics`
is a plain hook function; hooks have no directive requirement of their own
— the client/server boundary that matters is at the *call site* (an
already-`"use client"` component calling the hook), not at the hook's own
defining file. `useAnalytics` is re-exported as a plain re-export, without
its own `"use client"` marking.

**ESM/CJS**: matches issue 001's decision — both ESM and CJS builds (tsup,
matching root `typetrack`'s `tsup.config.ts` shape), for consistency with
this repo's existing dual-format convention, even though Next.js itself is
ESM-native today.

**Peer version floor**: `next`: `^14.0.0 || ^15.0.0 || ^16.0.0` (App Router
has been stable since 14; nothing in this issue depends on
16-specific features like Cache Components). `react`/`react-dom`:
`^19.0.0`, matching issue 001.

## Acceptance criteria

- `packages/next/package.json`:
  - `"name": "@typetrack/next"`, `"private": false`, `"type": "module"`.
  - `"main"`/`"module"`/`"types"`/`"exports"` shaped identically to
    `packages/react/package.json` (dist-based, ESM+CJS+d.ts).
  - `"files": ["dist"]`.
  - `"scripts"`: `"build": "tsup"`, `"lint": "oxlint"`,
    `"typecheck": "tsgo --noEmit"`, `"typecheck:tsc": "tsc --noEmit"`,
    `"test": "bun test"`.
  - `"peerDependencies"`: `"react": "^19.0.0"`, `"react-dom": "^19.0.0"`,
    `"next": "^14.0.0 || ^15.0.0 || ^16.0.0"` (all required).
  - `"dependencies"`: `"@typetrack/react": "file:../react"`,
    `"typetrack": "file:../.."`.
  - `"devDependencies"`: adds `"next"` (pinned to current stable, e.g.
    `16.x`) plus the same React/testing-library/happy-dom/toolchain set as
    issue 001.
- `packages/next/tsup.config.ts`: same shape as `packages/react`'s.
- `.github/workflows/qa.yml`'s "Build" step also builds `packages/next`
  **after** `packages/react` (dependency order — `packages/next` resolves
  `@typetrack/react` via `file:../react`, which requires `packages/react`'s
  `dist/` to already exist).
- `packages/next/src/AnalyticsProvider.tsx`:
  - First line is exactly `"use client";`, before any import statement.
  - Re-exports (or thinly wraps, with identical prop signature)
    `@typetrack/react`'s `AnalyticsProvider`, fully generic over `Events`
    (no narrowing to `unknown`/`any`).
- `packages/next/src/index.ts`: barrel re-exporting `AnalyticsProvider`
  (this package's client-marked one) and `useAnalytics` (plain re-export
  from `@typetrack/react`, unmarked).
- `packages/next/src/testSetup.ts`: same happy-dom register/unregister
  approach as issue 001 (duplicated, not shared cross-package, per issue
  001's Context).

## Test requirements

**Unit:**
- Read `packages/next/src/AnalyticsProvider.tsx`'s source text and assert
  its first line is exactly `"use client";` — a regression here (e.g. an
  import accidentally reordered above the directive) silently breaks
  Next.js builds with no TypeScript error, so this is a genuinely valuable
  plain-text assertion, not busywork.
- Assert `@typetrack/next`'s re-exported `AnalyticsProvider`/`useAnalytics`
  are the same underlying implementation as `@typetrack/react`'s (e.g.
  reference equality if implemented as a pure re-export, or behavioral
  equivalence otherwise) — proving this package is a thin pass-through, not
  a reimplementation.

**Integration** (real rendering via `@testing-library/react`):
- Render `<AnalyticsProvider analytics={fakeAnalytics}>` **imported from
  `@typetrack/next`** wrapping a consumer using `useAnalytics()` (also
  imported from `@typetrack/next`), asserting `track`/`identify`/`page`/
  `flush` calls reach `fakeAnalytics` exactly as in issue 001's
  integration test — proving the re-exported/wrapped component genuinely
  functions as a working context provider at runtime, not just that it
  type-checks.
- Full `bun test` from the repo root still passes, including issue 001's
  `packages/react` tests and all pre-existing tests.

**Explicitly not covered by automated tests** (documented, not silently
skipped): actually verifying Next.js's compiler-level enforcement of the
Server/Client Component boundary (e.g., that a Server Component importing
this file is correctly bundled for the client, or that omitting the
directive would break a real `next build`) would require scaffolding and
building a real Next.js application, which this issue's `bun test`-based
suite does not do. That guarantee is covered by the unit-level
first-line-directive assertion above (which is what Next's compiler keys
off of) plus manual verification in a real Next.js app — tracked as a
documented gap, not silently assumed away.

## Out of scope

- Automatic pageview tracking on route change — issue 003.
- Pages Router support (this phase is App Router only, per the phase
  brief).
- Scaffolding/building an actual Next.js application (e.g. via
  `create-next-app`) in CI to exercise a real build — see "Explicitly not
  covered" above.
- Any Next.js Server Action / Route Handler / middleware integration.
- Any change to `@typetrack/react`'s own source beyond what issue 001
  already produced.
