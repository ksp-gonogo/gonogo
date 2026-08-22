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
const shared = {
  format: ["esm"] as const,
  outDir: "dist",
  target: "es2022",
  sourcemap: true,
};

export default defineConfig([
  {
    ...shared,
    // `./testing` and `./guards` are SEPARATE entries, not part of the root
    // barrel: a runtime bundle must never pull testing code in, and an Uplink
    // author needs the readout helpers without them. `./guards` is split from
    // `./testing` in turn because it reads the filesystem, which would break a
    // browser-based test runner that only wanted the DOM helpers.
    //
    // The two halves of the Uplink render harness are configs of their OWN below,
    // and not entries here. Adding `render-probe` to this entry list is what a
    // first attempt did, and it moved `renderWidget` into a code-split chunk
    // shared with `./testing`: a chunk reachable only through `dist/testing.js`
    // does not evaluate under a consumer's vitest, so the namespace carried the
    // export names with every value `undefined` and eight of an Uplink's tests
    // failed with `renderWidget is not a function`. Nothing about this entry
    // list may change the chunking of the three below it.
    entry: ["src/index.ts", "src/testing.ts", "src/guards.ts"],
    clean: true,
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
  },
  {
    ...shared,
    // The BROWSER half of the render harness, built as a CONSUMER of the kit
    // rather than as part of it: `@ksp-gonogo/ui-kit` and its `/testing` subpath
    // stay external, so this file shares no chunk with them and there is exactly
    // one copy of the augment registry once an Uplink's probe bundle resolves
    // both. `splitting` is off because there is nothing left to share.
    entry: ["src/render-probe.tsx"],
    clean: false,
    splitting: false,
    external: [
      "@ksp-gonogo/ui-kit",
      "@ksp-gonogo/ui-kit/*",
      "@ksp-gonogo/sitrep-sdk",
      "@ksp-gonogo/sitrep-sdk/*",
      "react",
      "react-dom",
      "react/jsx-runtime",
      "styled-components",
    ],
    dts: { resolve: true },
  },
  {
    ...shared,
    // The NODE half: esbuild, Playwright, the filesystem, the GIF encoder and
    // the markdown generator. `clean` is off, this appends to the dist the
    // config above just wrote.
    // `page-check` is here rather than beside it because it must NOT pull
    // Playwright: it is the half of the gate an author with no browser can run,
    // and a static import of the driver would make it cost exactly what it
    // exists to avoid. `render-probe.exports.test.ts` holds it to that.
    entry: ["src/render.ts", "src/page-check.ts"],
    platform: "node",
    clean: false,
    // Same argument as the theme and lucide-react: small, pure JS and
    // dependency-free, so inlining keeps the kit's manifest free of runtime
    // dependencies. Reachable only from `dist/render.js`, which a browser bundle
    // never resolves.
    noExternal: ["gifenc"],
    external: [
      "@ksp-gonogo/sitrep-sdk",
      "@ksp-gonogo/sitrep-sdk/*",
      // Optional peers, both heavy and both node-only. Bundling Playwright would
      // be absurd; bundling esbuild would ship a second copy of a binary-backed
      // package.
      "esbuild",
      "playwright",
      // The generated browser entry resolves this from the AUTHOR's tree, so it
      // has to survive as an import string rather than being inlined here.
      "@ksp-gonogo/ui-kit",
      "@ksp-gonogo/ui-kit/*",
    ],
    dts: { resolve: true },
  },
]);
