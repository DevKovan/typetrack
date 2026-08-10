# @typetrack/next

Next.js App Router bindings ("use client" AnalyticsProvider boundary, useAnalytics) for typetrack.

## Install

```sh
bun add typetrack @typetrack/next
```

Requires React 19+ and Next.js 14/15/16.

## Usage

```tsx
// app/providers.tsx
"use client";
import { createAnalytics } from "typetrack";
import { AnalyticsProvider, AnalyticsPageView } from "@typetrack/next";

const analytics = createAnalytics();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AnalyticsProvider analytics={analytics}>
      <AnalyticsPageView />
      {children}
    </AnalyticsProvider>
  );
}
```

```tsx
// any client component
"use client";
import { useAnalytics } from "@typetrack/next";

function SignupButton() {
  const analytics = useAnalytics();
  return <button onClick={() => analytics.track("Signup Completed", { plan: "pro" })}>Sign up</button>;
}
```

`<AnalyticsPageView />` fires `.page()` automatically on client-side route
change (App Router has no built-in route-change event) — drop it once
inside your provider tree, no extra `<Suspense>` setup required.

See [`docs/README.md`](https://github.com/DevKovan/typetrack/blob/main/docs/README.md) for the full documentation index.
