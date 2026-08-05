// Ambient module declaration for `solid-js/web`'s explicit server-build deep
// import path -- see `index.ts`'s own header comment on its `renderToString`
// import for the full "why this deep path, not the plain `solid-js/web`
// specifier" reasoning. `solid-js` itself ships no `.d.ts` for this specific
// subpath (its own `types/` declarations are only wired up for the plain,
// condition-resolved `"solid-js/web"` specifier) -- this repo's shared
// `tsgo --noEmit`/`tsc --noEmit` needs this declared somewhere for
// `index.ts`'s static import to type-check at all. Only the one export this
// example actually imports is declared -- not a complete re-declaration of
// `solid-js/web`'s full surface.
declare module "solid-js/web/dist/server.js" {
  export function renderToString<T>(fn: () => T, options?: { nonce?: string; renderId?: string }): string;
}
