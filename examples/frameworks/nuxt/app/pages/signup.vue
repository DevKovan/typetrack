<script setup lang="ts">
// `useAnalytics` is auto-imported by `@typetrack/nuxt`'s module (`addImports`,
// `packages/nuxt/src/module.ts`) -- no explicit import line needed in a real
// Nuxt app. Shown as an explicit import here only because this file lives
// outside of a real Nuxt build's auto-import scanning.
import { useAnalytics } from "@typetrack/nuxt";

interface SignUpEvents {
  "User Signed Up": { plan: "free" | "pro" };
}

const analytics = useAnalytics<SignUpEvents>();
const email = ref("");
const submitted = ref(false);

function handleSubmit(): void {
  if (!email.value.includes("@")) return;

  void analytics.identify(email.value, { plan: "free", source: "signup_form" });
  void analytics.track("User Signed Up", { plan: "free" });
  submitted.value = true;
}
</script>

<template>
  <form @submit.prevent="handleSubmit">
    <input v-model="email" type="email" name="email" placeholder="you@example.com" />
    <button type="submit">Sign up</button>
    <p v-if="submitted" class="confirmation">Thanks for signing up!</p>
  </form>
</template>
