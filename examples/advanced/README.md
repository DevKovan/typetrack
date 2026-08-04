# examples/advanced

Runnable, self-contained demonstrations of `typetrack`'s Phase 12 reliability
surface: the `reliability` construction option (`storage`/`maxQueueSize`/
`maxAttempts`/`backoff`/`batch`/`flushOnUnload`), the always-present
`analytics.queue` runtime (`size()`/`drain()`/`clear()`), offline detection +
automatic `online`-triggered draining, `TrackOptions.priority`,
`ProviderCapabilities.batch` + `AnalyticsProvider.trackBatch` drain-loop
coalescing, and the `pagehide`-driven unload flush -- composed together the
way a real app would actually rely on them, not exercised one feature at a
time.

Per `plan/VISION.md`'s Examples policy, every feature ships its `examples/`
entries in the same phase that built it, so these never drift out of sync
with what's actually shipped -- this directory's integration test imports and
runs the example's own real entry point/app logic (never a re-implemented
copy of it) against the real `typetrack` API, so a future change to the
reliability surface that breaks this example's assumptions fails its own
tests, not just its prose.

None of `examples/` is part of any published npm package: it's excluded from
every package's `files`/`exports` and from `bun run build:all`/`tsup`'s
build steps -- this is documentation/demo code for people reading the repo
or running it locally, not shipped library code.

## Examples

- **[`offline-resilient-tracking/`](./offline-resilient-tracking)** -- a
  realistic e-commerce storefront session against a hand-written flaky,
  batch-capable vendor stub: several low-priority "Product Viewed" events and
  a high-priority "Checkout Started" event all queue during a vendor outage,
  the vendor recovers and a `flush()` drains everything in priority order
  while batching multiple ready events into one `trackBatch` call, a
  permanently-invalid event exhausts `maxAttempts` and is genuinely
  dead-lettered (not just eventually retried into success), the visitor goes
  offline mid-session and comes back (auto-draining on the browser's
  `online` event), and a final `pagehide` makes one last best-effort
  delivery attempt before `destroy()`.

Unlike [`examples/middleware`](../middleware)/[`examples/plugins`](../plugins)/
[`examples/recipes`](../recipes), this directory has only **one** example,
deliberately -- not several one-feature-per-directory toy directories, and
not even two composed recipes the way Phase 11 issue 008 (see
`examples/recipes`) chose. Every feature this phase built (the offline
queue, retry/backoff, `maxAttempts`/dead-lettering, `priority`, batching,
flush-on-unload) is a facet of *one* coherent reliability story an app either
opts into as a whole (via the single `reliability` option) or doesn't --
none of them is independently reachable or independently useful the way, say,
`redactMiddleware` and `samplingMiddleware` are two genuinely separate tools
an app might reach for on their own. Splitting this into multiple directories
would mean re-constructing the same `reliability`-enabled instance and stub
provider in each one, purely to demonstrate one narrow slice of behavior that
only actually matters in combination with the others (e.g. priority ordering
is invisible unless something is already queued; batching only coalesces
events that are already sitting in that same queue) -- so a single, fully
composed walkthrough is both more realistic and less repetitive than the
alternative.

Every example includes a `README.md` with source excerpts, the literal
expected output, an explanation of why the output looks the way it does, and
production notes -- and an integration test (running the example's real entry
point end to end against a hand-written stub provider, never live vendor
infrastructure or a real `packages/provider-*` adapter). No unit test exists
in this directory: see `offline-resilient-tracking/index.ts`'s own header
comment for why (no non-trivial pure logic of the example's own is defined,
beyond the stub provider's own scripted fail/recover/permanently-reject
logic, which is the same shape of hand-written test double every other
example in this repo already uses).
