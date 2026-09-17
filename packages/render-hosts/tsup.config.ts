import { defineConfig } from "tsup";

/**
 * One bundle carrying the whole private app graph, because a consumer of this
 * package cannot install any of it.
 *
 * `@ksp-gonogo/components` and everything under it (`core`, `data`, `logger`,
 * `sitrep-client`, `ui`, `theme`) are `private: true` workspace packages. They
 * are inlined here for the same reason `ui-kit` inlines the theme: the built
 * file has to stand alone in someone else's `node_modules`. tsup externalises
 * `dependencies` and `peerDependencies` and bundles the rest, and this manifest
 * has no `dependencies` at all, so the inlining is the default rather than a
 * list that can fall out of date as the graph moves.
 *
 * ## What must NOT be bundled, and what each one costs if it is
 *
 * Every name below is a peer, resolved from whoever is running the render.
 * These are not size choices; each is a module that breaks when there are two
 * of it in one page, and `render/page.ts` documents the same set from the
 * other side.
 *
 *   - `react` / `react-dom`: an augment mounted inside a host from a different
 *     copy of React throws "Cannot read properties of null (reading
 *     'useEffect')" from its first hook, because the copy it calls has no
 *     current dispatcher and the copy rendering it does
 *   - `styled-components`: keeps a module-level registry, so a second copy is a
 *     second theme context and a second stylesheet, and one side of the page
 *     renders unthemed
 *   - `@ksp-gonogo/ui-kit`: `Panel` is what mounts a host's augment and
 *     contribution slots. A host drawn by one copy of `Panel` and an augment
 *     registered against another share no slot at all
 *   - `@ksp-gonogo/sitrep-sdk`: its registries live on `globalThis` and survive
 *     duplication, which is exactly what makes a cross-package host resolvable;
 *     its `createContext` spine does not, so a second copy is a host widget
 *     that reads no telemetry and draws an empty frame
 *
 * The kit and the sdk are peers rather than dependencies on purpose: an Uplink
 * already has both, and they must be ITS copies, not a second pair arriving
 * underneath this package.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  clean: true,
  dts: true,
  external: [
    "react",
    "react-dom",
    "styled-components",
    "@ksp-gonogo/ui-kit",
    "@ksp-gonogo/sitrep-sdk",
  ],
});
