import { useState } from "react";
import { useAnalytics } from "@typetrack/remix";

interface SignUpEvents {
  "User Signed Up": { plan: "free" | "pro" };
}

// A realistic route component: reads `useAnalytics()` (re-exported,
// unmodified, from `@typetrack/react` -- see `packages/remix/src/index.ts`'s
// own header comment) and fires `identify()` + `track("User Signed Up",
// ...)` on submit.
export default function SignUp() {
  const analytics = useAnalytics<SignUpEvents>();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!email.includes("@")) return;

    void analytics.identify(email, { plan: "free", source: "signup_form" });
    void analytics.track("User Signed Up", { plan: "free" });
    setSubmitted(true);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        name="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit">Sign up</button>
      {submitted ? <p className="confirmation">Thanks for signing up!</p> : null}
    </form>
  );
}
