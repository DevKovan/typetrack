# @typetrack/react

React bindings (AnalyticsProvider, useAnalytics) for typetrack.

## Install

```sh
bun add typetrack @typetrack/react
```

Requires React 19+.

## Usage

```tsx
import { createAnalytics } from "typetrack";
import { AnalyticsProvider, useAnalytics } from "@typetrack/react";

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
