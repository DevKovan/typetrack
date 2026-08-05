// `@babel/preset-typescript` and `babel-preset-solid` ship no `.d.ts` of
// their own, and no `@types/*` package publishes one for either (confirmed
// via `npm view @types/babel__preset-typescript`/`npm view @types/babel-
// preset-solid`, both 404 -- `@babel/core` itself is typed separately via
// `@types/babel__core`, a real devDependency here). Both presets' actual
// runtime shape (used only by `testSetup.ts`, passed straight through to
// `babel.transformFileAsync`'s own `presets` array, which `@types/babel__
// core` already types loosely as `PluginItem[]`) needs no more precision
// than a bare default export here -- this repo's own code never inspects
// either preset's internals, only forwards them to Babel.
declare module "@babel/preset-typescript" {
  const preset: unknown;
  export default preset;
}

declare module "babel-preset-solid" {
  const preset: unknown;
  export default preset;
}
