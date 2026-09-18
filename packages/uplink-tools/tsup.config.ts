import { defineConfig } from "tsup";

/**
 * Three entries that must never share a chunk, for three different reasons.
 *
 * It is its own package because a design system has no business shipping a
 * Playwright-driven doc harness, and because the render HOSTS need
 * `@ksp-gonogo/components`, which depends on the kit: carrying them inside the
 * kit is a build-graph cycle, and outside it is an ordinary one-way
 * dependency.
 *
 * The kit is a PEER here, in one direction only. `gridUnits` is the single
 * module this package takes back from it.
 */
const shared = {
  format: ["esm"] as const,
  outDir: "dist",
  target: "es2022",
  sourcemap: true,
};

/** Never bundled: two copies of any of these breaks the page. See `page.ts`. */
const PEERS = [
  "@ksp-gonogo/ui-kit",
  "@ksp-gonogo/ui-kit/*",
  "@ksp-gonogo/sitrep-sdk",
  "@ksp-gonogo/sitrep-sdk/*",
  "react",
  "react-dom",
  "react/jsx-runtime",
  "styled-components",
];

export default defineConfig([
  {
    ...shared,
    /**
     * The BROWSER half, built as a CONSUMER of the kit rather than as part of
     * it: `@ksp-gonogo/ui-kit` and its subpaths stay external, so this file
     * shares no chunk with them and there is exactly one copy of the augment
     * registry once an Uplink's probe bundle resolves both. `splitting` is off
     * because there is nothing left to share.
     */
    entry: ["src/render-probe.tsx"],
    clean: true,
    splitting: false,
    external: PEERS,
    dts: { resolve: true },
  },
  {
    ...shared,
    // The NODE half: esbuild, Playwright, the filesystem, the GIF encoder and
    // the markdown generator. `clean` is off, this appends to the dist above.
    //
    // `page-check` is a separate entry because it must NOT pull Playwright: it
    // is the half of the gate an author with no browser can run, and a static
    // import of the driver would make it cost exactly what it exists to avoid.
    entry: ["src/index.ts", "src/page-check.ts"],
    platform: "node",
    clean: false,
    // Small, pure JS and dependency-free, so inlining keeps this manifest free
    // of runtime dependencies. Reachable only from `dist/index.js`, which a
    // browser bundle never resolves.
    noExternal: ["gifenc"],
    external: [
      ...PEERS,
      // Optional peers, both heavy and both node-only. Bundling Playwright
      // would be absurd; bundling esbuild would ship a second copy of a
      // binary-backed package.
      "esbuild",
      "playwright",
    ],
    dts: { resolve: true },
  },
  {
    ...shared,
    /**
     * The render HOSTS: the app's own widgets, registered, so an Uplink's docs
     * page can draw an augment or a contribution inside the REAL host it
     * extends rather than a stand-in whose body draws nothing.
     *
     * Its own entry, and NOT part of the root barrel, because the two are
     * opposite kinds of thing. The barrel is a Node API an author imports for
     * its functions; this is a side-effect module carrying the whole private
     * app graph as browser code. Rolled together, `gonogo-uplink docs` would
     * load a megabyte of widgets into a Node CLI on every run, and importing
     * the harness would register the app's widgets as a side effect.
     *
     * `@ksp-gonogo/components` and everything under it (`core`, `data`,
     * `logger`, `sitrep-client`, `ui`, `theme`) are `private: true` and are
     * inlined, because a consumer cannot install any of them. tsup externalises
     * `dependencies` and `peerDependencies` and bundles the rest, so the
     * inlining is the default rather than a list that goes stale as the graph
     * moves.
     *
     * Every name in `PEERS` stays external, and each is a module that breaks
     * when a page holds two of it: React (an augment mounted in a host from a
     * different copy throws on its first hook, because the copy it calls has no
     * current dispatcher), styled-components (a second theme context and a
     * second stylesheet, so one side renders unthemed), the kit (a host drawn
     * by one copy of `Panel` and an augment registered against another share no
     * slot at all), and the sdk (its registries live on `globalThis` and
     * survive duplication, but its `createContext` spine does not, so a second
     * copy is a host widget that reads no telemetry and draws an empty frame).
     */
    entry: ["src/widgets.ts"],
    platform: "browser",
    clean: false,
    splitting: false,
    external: [
      ...PEERS,
      // Arrives only through `@ksp-gonogo/sitrep-client`'s root barrel, which
      // re-exports `createFakeWallClock` and `StubTransport` from files whose
      // only job is to forward `@ksp-gonogo/sitrep-sdk/testing`. A
      // `export ... from` across an external boundary cannot be tree-shaken, so
      // the specifier survives into `dist` whether or not a widget ever calls
      // it. Nothing here uses it.
      "@testing-library/react",
    ],
    dts: true,
  },
]);
