# vercel-edge

A minimal Next.js App Router route handler (`app/api/track/route.ts`,
`export const runtime = "edge"`) using `typetrack` and
`@typetrack/provider-posthog`'s `createPostHogFetchProvider` (this phase's
new, zero-vendor-dependency, `fetch()`-only PostHog adapter variant) to
`identify()` and `track()` a `"Checkout Started"` event from an incoming
request body, constructing a fresh `Analytics` instance *per request*.

## Testing

**Not exercised by this repo's own CI/`bun test` suite.** Per
`plan/phase-13-runtime-agnostic/BRIEF.md` decision 5, this repo does not add
Next.js, Vercel, or any Edge-Runtime-specific tooling as a devDependency
anywhere in the monorepo (`CLAUDE.md`: "toolchain is devDependencies only:
Bun/tsgo/typescript/oxlint/Knip/tsup"). Nothing in this directory is
installed, type-checked, or run by `bun install`/`bun test`/`bun run
typecheck` at the repo root -- a passing `bun test` at the repo root proves
nothing about whether this route actually runs.

## Prerequisites

- An existing Next.js (App Router) project of your own, with `typetrack`
  and `@typetrack/provider-posthog` installed as dependencies (`npm install
  typetrack @typetrack/provider-posthog`).
- A Vercel account (for `vercel deploy`), or just `next dev` locally if
  you only want to exercise the route on your own machine.
- A real PostHog project API key (`POSTHOG_API_KEY`, set as an environment
  variable -- never hardcoded).

## How to run

Copy `app/api/track/route.ts` into your own Next.js project at the same
path, set `POSTHOG_API_KEY`, then:

```sh
# Local dev server:
next dev
# POST http://localhost:3000/api/track with a JSON body of
# { "userId": "...", "cartTotal": ..., "itemCount": ... }

# Deploy to Vercel:
vercel deploy
```

## Source

```ts
export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();

  const analytics = createAnalytics({
    provider: createPostHogFetchProvider({ apiKey: process.env.POSTHOG_API_KEY! }),
  });

  await analytics.identify(body.userId);
  await analytics.track("Checkout Started", { cartTotal: body.cartTotal, itemCount: body.itemCount });
  await analytics.flush();

  return Response.json({ ok: true });
}
```

## Explanation

`export const runtime = "edge"` is Next.js's own documented mechanism for
opting a route handler into Vercel's Edge Runtime (a V8-isolate
environment) instead of the default Node.js runtime. `createAnalytics()`
and `createPostHogFetchProvider` are constructed fresh, *inside* the `POST`
handler, on every single invocation -- never at module scope above it. This
matters specifically because Edge Functions are stateless, short-lived
isolates: Vercel makes no guarantee that the same isolate (or any
particular process lifetime) handles the next request, so a module-level
`const analytics = createAnalytics(...)` risks its state (or, more subtly,
assumptions built on it persisting) silently not surviving between
invocations. A typical long-lived Node.js server is the opposite case: its
process (and module scope) genuinely does outlive every request, which is
exactly what makes a module-level singleton `Analytics` instance both safe
and the normal, idiomatic choice there -- constructing a fresh instance per
request in *that* environment would just be wasted, unnecessary overhead.

## Production notes

- **Per-request `Analytics` construction is the correctness-critical
  pattern for this runtime, not a stylistic preference.** Contrast directly
  with a typical Node.js Express/Fastify/etc. server, where `const
  analytics = createAnalytics(...)` at module scope, constructed once at
  process startup and reused for the process's whole lifetime, is the
  right call -- the two environments' actual lifecycle guarantees are
  different, and the pattern should follow that, not copy verbatim from one
  to the other.
- **`createPostHogFetchProvider` has no client-side queue of its own** --
  every method call issues and awaits its own immediate `fetch()` request.
  Phase 12's reliability queue (`src/reliability/`, via the `reliability`
  `createAnalytics()` option) is the natural pairing partner if you want
  retry/offline-queueing behavior on top of this adapter -- this example
  doesn't enable it, to stay minimal.
- **Never read secrets like `POSTHOG_API_KEY` from anywhere but your
  platform's environment-variable mechanism** (Vercel's Project ->
  Settings -> Environment Variables, or `.env.local` for `next dev`) --
  never hardcode a real key in source.
