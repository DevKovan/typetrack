# @typetrack/solid

SolidJS bindings (AnalyticsProvider, useAnalytics) for typetrack.

## Install

```sh
bun add typetrack @typetrack/solid
```

Requires Solid 1.9+.

## Usage

```tsx
import { createAnalytics } from "typetrack";
import { AnalyticsProvider, useAnalytics } from "@typetrack/solid";

const analytics = createAnalytics();

function App() {
  return (
    <AnalyticsProvider analytics={analytics}>
      <SignupButton />
    </AnalyticsProvider>
  );
}

function SignupButton() {
  const analytics = useAnalytics();
  return <button onClick={() => analytics.track("Signup Completed", { plan: "pro" })}>Sign up</button>;
}
```

`useAnalytics()` throws if called outside an `AnalyticsProvider` — a
missing provider is a loud, immediate error, not a silent no-op.

See [`docs/README.md`](https://github.com/DevKovan/typetrack/blob/main/docs/README.md) for the full documentation index.
