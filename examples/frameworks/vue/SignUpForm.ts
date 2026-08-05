/// <reference lib="dom" />
// The reference directive above is load-bearing, not decorative: the shared
// root `tsconfig.json`'s `"lib": ["ES2022"]` deliberately excludes `"dom"`
// (core ships zero browser-global assumptions) -- this file, unlike core,
// is genuine browser UI code that needs `HTMLInputElement`'s real `.value`
// member typed correctly. A per-file triple-slash directive pulls in
// `lib.dom.d.ts` for just this file's own type-checking, without changing
// the shared tsconfig's global `lib` array (which every other package/
// example in this repo, including this one's own SSR-only `index.ts`,
// still correctly typechecks without).
import { defineComponent, h, ref } from "vue";
import { useAnalytics, type EventMap } from "@typetrack/vue";
import { buildIdentifyTraits, buildUserSignedUpProperties, isValidSignUpEmail, type SignUpFormValues } from "./formLogic";

// A realistic small sign-up form component, written with Vue's plain `h()`
// render-function API rather than a `.vue` SFC -- deliberate, not a
// simplification for this example's sake: `@typetrack/vue`'s own package
// needs no SFC/template compiler at all (Design decision 2,
// `plan/phase-14-framework-wrappers/BRIEF.md`), and this component mirrors
// that same "plain Composition API function calls" shape, avoiding any new
// `@vitejs/plugin-vue`-style build/test toolchain dependency this repo
// doesn't otherwise need. A real app is equally free to author the same
// logic as a `.vue` SFC -- the `useAnalytics()` call inside `setup()` works
// identically either way.
export interface SignUpEvents extends EventMap {
  "User Signed Up": { plan: "free" | "pro" };
}

export const SignUpForm = defineComponent({
  name: "SignUpForm",
  setup() {
    // Reads the `Analytics` instance installed by an ancestor
    // `app.use(typetrackPlugin, { analytics })` call -- throws a descriptive
    // error if none is present (see `@typetrack/vue`'s own `useAnalytics()`
    // contract), exactly like every other package in this phase.
    const analytics = useAnalytics<SignUpEvents>();
    const emailInput = ref<HTMLInputElement | null>(null);
    const submitted = ref(false);

    function handleSubmit(event: Event): void {
      event.preventDefault();
      const email = emailInput.value?.value ?? "";
      if (!isValidSignUpEmail(email)) {
        return;
      }

      const values: SignUpFormValues = { email, plan: "free" };

      // `identify()` associates this browser's `anonymousId` with a known
      // user; `track()` records the sign-up itself as a distinct event --
      // the same two-call sequence every other package's own example/test
      // fixture in this phase uses (mirrors
      // `packages/vue/src/useAnalytics.test.ts`'s `ConsumerComponent`).
      void analytics.identify(email, buildIdentifyTraits(values));
      void analytics.track("User Signed Up", buildUserSignedUpProperties(values));
      submitted.value = true;
    }

    return () =>
      h("form", { onSubmit: handleSubmit }, [
        h("input", {
          ref: emailInput,
          type: "email",
          name: "email",
          placeholder: "you@example.com",
        }),
        h("button", { type: "submit" }, "Sign up"),
        submitted.value ? h("p", { class: "confirmation" }, "Thanks for signing up!") : null,
      ]);
  },
});
