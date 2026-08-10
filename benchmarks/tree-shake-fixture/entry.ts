// The "smallest possible real usage" case for Phase 19 issue 003's
// tree-shaking measurement (`plan/phase-19-performance-benchmarking/
// 003-bundle-size-tree-shaking-comparison.md`, Part B). Imports only
// `createAnalytics` + `noopProvider` -- no middleware, no plugins, no
// schemas -- from the real, installed `typetrack` package (this workspace's
// own `node_modules/typetrack`, a `file:..` dependency resolving to the
// actually-built `dist/` output), not a relative `../../src` import, so
// bundling this file exercises exactly what an app's own bundler would see
// when it depends on the published package shape.
import { createAnalytics, noopProvider } from "typetrack";

createAnalytics({ provider: noopProvider });
