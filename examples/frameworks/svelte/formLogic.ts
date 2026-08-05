// Pure helper functions -- no I/O, no Svelte, no `typetrack` import at all
// -- deliberately kept separate from `SignUpForm.svelte`'s own DOM/
// component concerns, so they're straightforward to unit-test in isolation
// (see `formLogic.test.ts`). Mirrors `examples/frameworks/vue/formLogic.ts`'
// own convention (deliberately identical shape across all three
// tested-in-repo framework examples, for cross-framework consistency).

export interface SignUpFormValues {
  email: string;
  plan: "free" | "pro";
}

// `identify()`'s traits payload: who signed up, and how we know them.
export function buildIdentifyTraits(values: SignUpFormValues): Record<string, unknown> {
  return { plan: values.plan, source: "signup_form" };
}

// `track("User Signed Up", ...)`'s properties payload -- deliberately a
// narrower shape than `buildIdentifyTraits` (no `source`, which belongs to
// identity resolution, not this specific event).
export function buildUserSignedUpProperties(values: SignUpFormValues): { plan: "free" | "pro" } {
  return { plan: values.plan };
}

// A tiny, realistic piece of validation logic (not every email-shaped string
// should route to `analytics.identify()`) -- the second non-trivial pure
// function this file exports, so `formLogic.test.ts` has more than one
// straightforward assertion.
export function isValidSignUpEmail(email: string): boolean {
  return email.trim().length > 0 && email.includes("@") && !email.startsWith("@") && !email.endsWith("@");
}
