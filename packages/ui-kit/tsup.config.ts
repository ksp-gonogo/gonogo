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
  external: ["react", "react-dom", "react/jsx-runtime", "styled-components"],
  dts: {
    // `true`, not `["@ksp-gonogo/theme"]`. Naming the package only inlines its
    // entry `.d.ts`; the relative re-exports *inside* it (`./theme`,
    // `./defaultDarkTheme`, …) are then left as-is, emitting imports of files
    // that don't exist in our dist. `true` follows them through. Peers stay
    // external regardless: `external` above governs the dts pass too.
    resolve: true,
  },
});
