<script lang="ts">
  import { useAnalytics, type EventMap } from "@typetrack/svelte";
  import { buildIdentifyTraits, buildUserSignedUpProperties, isValidSignUpEmail, type SignUpFormValues } from "./formLogic";

  // A realistic small sign-up form component: on submit, calls
  // `analytics.identify(email, ...)` followed by
  // `analytics.track("User Signed Up", ...)`. Mirrors
  // `examples/frameworks/vue/SignUpForm.ts`'s own convention (deliberately
  // identical shape across all three tested-in-repo framework examples).
  interface SignUpEvents extends EventMap {
    "User Signed Up": { plan: "free" | "pro" };
  }

  // Reads the `Analytics` instance provided by the nearest ancestor
  // `<AnalyticsProvider analytics={...}>` via Svelte's Context API -- throws
  // a descriptive error if none is present (see `@typetrack/svelte`'s own
  // `useAnalytics()` contract), exactly like every other package in this
  // phase. Must be called during this component's own synchronous
  // initialization (a Svelte runtime constraint) -- which is exactly why
  // this call lives directly in this file's top-level `<script>` block, not
  // inside `handleSubmit`.
  const analytics = useAnalytics<SignUpEvents>();

  // `bind:this={emailInput}` below is what actually assigns this binding --
  // invisible to oxlint's own static analysis of this `<script>` block,
  // hence the disable (a real, accepted false positive, not a genuine
  // unused/always-undefined variable).
  // eslint-disable-next-line no-unassigned-vars
  let emailInput: HTMLInputElement | undefined;
  let submitted = $state(false);

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const email = emailInput?.value ?? "";
    if (!isValidSignUpEmail(email)) {
      return;
    }

    const values: SignUpFormValues = { email, plan: "free" };
    void analytics.identify(email, buildIdentifyTraits(values));
    void analytics.track("User Signed Up", buildUserSignedUpProperties(values));
    submitted = true;
  }
</script>

<form onsubmit={handleSubmit}>
  <input bind:this={emailInput} type="email" name="email" placeholder="you@example.com" />
  <button type="submit">Sign up</button>
  {#if submitted}
    <p class="confirmation">Thanks for signing up!</p>
  {/if}
</form>
