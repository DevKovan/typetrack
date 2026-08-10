# typetrack documentation

typetrack's Golden Rule (see `plan/VISION.md`): your application depends
only on `typetrack`, never on a vendor analytics SDK directly. Providers
(GA4, PostHog, Segment, ...) are swappable implementation details behind
one shared `AnalyticsProvider` interface — switching vendors means editing
the one file that constructs `createAnalytics()`, not your application
code, event names, or payloads.

## Guides

- **[Architecture](./architecture.md)** — how an event actually flows from
  `track()` to a provider, the canonical event model, and why the pieces
  are split the way they are.
- **[Cookbook](./cookbook.md)** — short, task-oriented "how do I...?"
  recipes with real, runnable code.
- **[Migration guide](./migration.md)** — moving from direct PostHog/
  Segment/GA4 SDK usage (or this repo's own pre-Phase-6 event shape) to
  typetrack.
- **Provider guides** — per-adapter setup, config, capabilities, and
  limitations:
  - [GA4](./providers/ga4.md)
  - [PostHog](./providers/posthog.md)
  - [Segment](./providers/segment.md)
- **[Plugins](./plugins.md)** — the eight built-in `auto*` plugins
  (pageviews, clicks, scroll depth, errors, web vitals, and more) and how
  to write your own.
- **[Middleware](./middleware.md)** — the `.use()` chain, execution order,
  and the eight built-in middlewares (redaction, PII filtering, sampling,
  logging, enrichment, version injection, timing, and a debug overlay).
- **[Performance](./performance.md)** — what's free, what's opt-in cost,
  the current bundle-size/regression budgets, and real internal +
  cross-library (PostHog/Segment/RudderStack) benchmark numbers, with links
  out to `benchmarks/results/*.md` and `benchmarks/README.md` to reproduce
  them.
- **[Comparison](./comparison.md)** — typetrack vs. direct PostHog/Segment/
  RudderStack SDK usage.
- **[Tooling](./tooling.md)** — the `typetrack schema`/`typetrack docs` CLI
  commands, the dev server's event inspector UI, and the debug overlay
  middleware.
- **[FAQ](./faq.md)** — fast answers to common questions, linking to the
  guide above that covers each topic in full.

## Where to start

New to typetrack? Read the root [`README.md`](../README.md)'s quickstart
first, then [Architecture](./architecture.md) for the mental model, then
the [Cookbook](./cookbook.md) for the specific thing you're trying to do.

Already using a vendor SDK directly? Start with the
[migration guide](./migration.md).
