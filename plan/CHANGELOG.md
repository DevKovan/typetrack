# Plan changelog

One-liner per phase once its issue/brief files are removed — code and tests
are the record, this is just a trail of what happened when.

- Phase 0 (foundations): repo scaffold, Bun workspace toolchain (tsgo/tsc,
  oxlint, knip, tsup), CI, subagents, git-discipline + grill-me skills.
- Phase 1 (core): `createAnalytics<Events>()` generic factory, optional
  per-event Zod schemas via `z.infer`, configurable `onValidationError`.
