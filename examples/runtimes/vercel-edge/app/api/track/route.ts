// A minimal Vercel Edge Function (Next.js App Router route handler) using
// `typetrack` and `@typetrack/provider-posthog`'s `createPostHogFetchProvider`
// (this phase's new, zero-vendor-dependency, `fetch()`-only PostHog adapter
// variant -- see that package's own `runtimes` capability research) to track
// a `"Checkout Started"` event derived from the incoming request.
//
// NOT run by this repo's own `bun test`/CI -- see
// `examples/runtimes/README.md` and this directory's own README.md
// "Testing" note for why (per `plan/phase-13-runtime-agnostic/BRIEF.md`
// decision 5, this repo does not add Vercel/Next.js tooling as a
// devDependency). A reader would copy this file into their own Next.js
// App Router project's `app/api/track/route.ts`.

import { createAnalytics } from "typetrack";
import { createPostHogFetchProvider } from "@typetrack/provider-posthog";

// `export const runtime = "edge"` opts this route into Vercel's Edge
// Runtime (a V8-isolate environment, not Node.js) -- Next.js's own
// documented mechanism for choosing the Edge Runtime over the default
// Node.js runtime for a given route handler.
export const runtime = "edge";

interface CheckoutStartedBody {
  userId: string;
  cartTotal: number;
  itemCount: number;
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as CheckoutStartedBody;

  // Constructed fresh, INSIDE the request handler -- never as a
  // module-level `const analytics = createAnalytics(...)` above this
  // function. Edge Functions are stateless, short-lived V8 isolates:
  // Vercel does not guarantee the same isolate (or any particular
  // lifetime) handles the next request, so a module-level singleton risks
  // silently losing whatever in-memory state it accumulated (there is none
  // here, but the pattern generalizes) the moment a fresh isolate spins up
  // -- unlike a typical long-lived Node.js server process, where a
  // module-level singleton `Analytics` instance is the normal, correct
  // choice specifically *because* the process (and its module scope)
  // outlives every individual request.
  const analytics = createAnalytics({
    provider: createPostHogFetchProvider({ apiKey: process.env.POSTHOG_API_KEY! }),
  });

  await analytics.identify(body.userId);
  await analytics.track("Checkout Started", { cartTotal: body.cartTotal, itemCount: body.itemCount });

  // No client-side queue exists on this fetch-based adapter (every method
  // already issues and awaits its own request) -- `flush()` here is a
  // deliberate, cheap correctness habit (matching `../cloudflare-worker`'s
  // own `ctx.waitUntil(analytics.flush())` comment) rather than strictly
  // necessary for *this* handler, since `track()` above is already awaited.
  await analytics.flush();

  return Response.json({ ok: true });
}
