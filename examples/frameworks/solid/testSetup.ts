// Registers this example's own CSR-targeted Solid JSX Bun plugin (`./
// solidJsxPlugin.ts`) and happy-dom's DOM globals, for `@solidjs/
// testing-library`'s `render()` to render into. Mirrors
// `packages/solid/src/testSetup.ts`'s own established precedent and
// reasoning exactly (see that file's own header comment for the full "why"
// -- `solid-js`/`@solidjs/testing-library` must load *after*
// `GlobalRegistrator.register()` runs).
import "./solidJsxPlugin";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
