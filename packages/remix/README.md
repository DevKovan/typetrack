# @typetrack/remix

React Router v8 framework-mode bindings (AnalyticsProvider re-export, useAnalytics re-export, route-aware AnalyticsPageView) for typetrack.

## Install

```sh
bun add typetrack @typetrack/remix
```

Requires React 19+ and React Router 8+.

## Usage

```tsx
// app/root.tsx
import { createAnalytics } from "typetrack";
import { AnalyticsProvider, AnalyticsPageView } from "@typetrack/remix";

const analytics = createAnalytics();

export default function App() {
  return (
    <AnalyticsProvider analytics={analytics}>
      <AnalyticsPageView />
      <Outlet />
    </AnalyticsProvider>
  );
}
```

```tsx
// any route component
import { useAnalytics } from "@typetrack/remix";

function SignupButton() {
  const analytics = useAnalytics();
  return <button onClick={() => analytics.track("Signup Completed", { plan: "pro" })}>Sign up</button>;
}
```

`<AnalyticsPageView />` fires `.page()` automatically on client-side route
change, via `react-router`'s `useLocation()`. React Router v8's default
framework mode has no Server/Client Component split, so `AnalyticsProvider`
works directly with no `"use client"` boundary needed (unlike
`@typetrack/next`).

See [`docs/README.md`](https://github.com/DevKovan/typetrack/blob/main/docs/README.md) for the full documentation index.
