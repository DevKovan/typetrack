/** @jsxImportSource solid-js */
// The pragma above is load-bearing, not decorative -- see
// `./solidJsxPlugin.ts`'s own header comment, and `packages/solid/src/
// AnalyticsProvider.tsx`'s identical pragma, for the full "why" (the shared
// root `tsconfig.json`'s `"jsx": "react-jsx"` stays untouched; this file's
// own JSX is redirected, per-file, to `solid-js/jsx-runtime`'s types for
// type-checking purposes only -- actual compilation is handled by
// `./solidJsxPlugin.ts`'s registered Bun plugin).
import { createSignal } from "solid-js";
import { useAnalytics, type EventMap } from "@typetrack/solid";
import { buildIdentifyTraits, buildUserSignedUpProperties, isValidSignUpEmail, type SignUpFormValues } from "./formLogic";

// A realistic small sign-up form component: on submit, calls
// `analytics.identify(email, ...)` followed by
// `analytics.track("User Signed Up", ...)`. Mirrors
// `examples/frameworks/vue/SignUpForm.ts`'s own convention (deliberately
// identical shape across all three tested-in-repo framework examples).
export interface SignUpEvents extends EventMap {
  "User Signed Up": { plan: "free" | "pro" };
}

export function SignUpForm() {
  // Reads the `Analytics` instance provided by the nearest ancestor
  // `<AnalyticsProvider analytics={...}>` -- throws a descriptive error if
  // none is present (see `@typetrack/solid`'s own `useAnalytics()`
  // contract), exactly like every other package in this phase.
  const analytics = useAnalytics<SignUpEvents>();
  // Per Solid's own documented `ref` convention: a plain, non-destructured
  // local `let` binding assigned via `ref={...}`, not a signal -- reading a
  // DOM node's current value needs no reactivity of its own. `ref={...}`
  // below is what actually assigns this binding (compiled by
  // `./solidJsxPlugin.ts`/`./compileForServer.ts` into a direct assignment)
  // -- invisible to oxlint's own static analysis, which only sees the
  // uncompiled JSX source, hence the disable below (a real, accepted false
  // positive, not a genuine unused/always-undefined variable).
  // eslint-disable-next-line no-unassigned-vars
  let emailInput: HTMLInputElement | undefined;
  const [submitted, setSubmitted] = createSignal(false);

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const email = emailInput?.value ?? "";
    if (!isValidSignUpEmail(email)) {
      return;
    }

    const values: SignUpFormValues = { email, plan: "free" };
    void analytics.identify(email, buildIdentifyTraits(values));
    void analytics.track("User Signed Up", buildUserSignedUpProperties(values));
    setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input ref={emailInput} type="email" name="email" placeholder="you@example.com" />
      <button type="submit">Sign up</button>
      {submitted() ? <p class="confirmation">Thanks for signing up!</p> : null}
    </form>
  );
}
