import { defineConfig } from "tsup";

/**
 * The kit is published to public npm and must stay self-contained: its manifest
 * declares no dependencies, only `react`/`styled-components` peers.
 *
 * `@ksp-gonogo/theme` is an internal, `private: true` workspace package, it is
 * never published. The kit is the theme's only public surface, so the build has
 * to inline it rather than reference it. A plain `tsc` build cannot do that,
 * which is what this bundler is here for:
 *
 *   - `noExternal` inlines the theme's JS into `dist/index.js`.
 *   - `dts.resolve` inlines the theme's *types* into `dist/index.d.ts`, so the
 *     emitted declarations carry `UiKitTheme`, `defaultDarkTheme` et al. outright
 *     instead of re-exporting them from a package no consumer can install.
 *
 * `lucide-react` (the icon set behind `./Icons`) is inlined the same way, so
 * the kit's icon exports work with zero extra installs for a consumer,
 * export-safe means the peer list stays exactly react/react-dom/styled-components.
 *
 * Everything in `external` is a peer and must NEVER be bundled. styled-components
 * keeps a module-level registry, so a second copy inside our bundle would produce
 * components that silently don't share a ThemeProvider with the host app's.
 */
export default defineConfig({
  // `./testing` and `./guards` are SEPARATE entries, not part of the root
  // barrel: a runtime bundle must never pull testing code in, and an Uplink
  // author needs the readout helpers without them. `./guards` is split from
  // `./testing` in turn because it reads the filesystem, which would break a
  // browser-based test runner that only wanted the DOM helpers.
  //
  // The RENDER harness is NOT here: it is `@ksp-gonogo/sitrep-sdk/testing`, so
  // an Uplink has one import site for its whole harness and the kit keeps its
  // empty dependency list.
  entry: ["src/index.ts", "src/testing.ts", "src/guards.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "es2022",
  clean: true,
  sourcemap: true,
  // Inline the internal, never-published theme package + lucide-react (icons).
  noExternal: ["@ksp-gonogo/theme", "lucide-react"],
  // Peers: resolved from the consumer's tree, never bundled.
  //
  // `@ksp-gonogo/sitrep-sdk` is here because it MUST be, and it was not. It is a
  // devDependency, which tsup bundles, so `dist/index.js` shipped a second copy of
  // the sdk with no `@ksp-gonogo/*` import left in it at all. Everything this
  // package reached for was either a type (erased) or backed by a `globalThis` slot
  // (`PerfBudget`'s registry, the action-handler map), which is why nothing failed:
  // both copies found the same state.
  //
  // The contribution aggregation is the first thing here to read a React CONTEXT
  // across that line, and it failed immediately: `useTelemetryClientOptional()`
  // returned undefined inside `ContributionsProvider` while the test's fixture had
  // mounted a client, because the two were different context objects. A
  // `requires`-gated contribution then silently never ran. Same class as ui-kit
  // being inlined into the test harness and `registerAugment` writing to a copy
  // `<AugmentSlot>` never read.
  //
  // The subpath wildcard is not decoration: an `external` entry matches the exact
  // specifier, so `@ksp-gonogo/sitrep-sdk` alone would leave
  // `@ksp-gonogo/sitrep-sdk/spine` and `/testing` inlined, which is the same bug
  // with a longer path.
  //
  // Listed HERE and left in `devDependencies` rather than promoted to a
  // `peerDependency`, which is what it should be on the published manifest and
  // cannot be yet: a peer entry on a workspace package makes pnpm resolve a per-peer
  // INSTANCE of ui-kit and core, copying only each package's `files`, and the sdk's
  // in-workspace `exports` map points at `./src`, which a copy does not carry. The
  // whole workspace then fails to typecheck with "Cannot find module './api'". So
  // the published manifest under-declares this one edge, which is survivable because
  // every consumer of ui-kit in and out of this repo already depends on the sdk
  // directly, and the alternative breaks every build here.
  external: [
    "@ksp-gonogo/sitrep-sdk",
    "@ksp-gonogo/sitrep-sdk/*",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "styled-components",
  ],
  dts: {
    // `true`, not `["@ksp-gonogo/theme"]`. Naming the package only inlines its
    // entry `.d.ts`; the relative re-exports *inside* it (`./theme`,
    // `./defaultDarkTheme`, …) are then left as-is, emitting imports of files
    // that don't exist in our dist. `true` follows them through. Peers stay
    // external regardless: `external` above governs the dts pass too.
    resolve: true,
  },
});
