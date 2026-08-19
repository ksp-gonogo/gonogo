import { defineConfig } from "tsup";

/**
 * Published, and it depends on `@ksp-gonogo/core` and `@ksp-gonogo/sitrep-client`,
 * which are `private: true` and never published. So the build has to INLINE them
 * rather than reference them, exactly as `@ksp-gonogo/ui-kit` inlines
 * `@ksp-gonogo/theme`: a manifest naming a package nobody can install is a
 * module-not-found on someone else's machine, which is the same defect this whole
 * package exists to remove.
 *
 * `dts.resolve` does the same for the types, following the relative re-exports
 * inside those packages rather than emitting imports of files that are not in our
 * dist.
 *
 * **A consumer therefore gets a bundled copy of the registry, and that is
 * coherent.** Their test installs THIS copy as the sdk host, so the shims their
 * widget calls and the helpers their test calls resolve to one registry for the
 * run. In this repo nothing bundles at all: workspace resolution wins and every
 * package shares the same singletons.
 *
 * `@ksp-gonogo/sitrep-sdk` is deliberately NOT inlined. It is published, so a
 * consumer resolves it themselves, and bundling it would put a second copy of the
 * host shims in their tree: the shims read `globalThis`, so both copies would find
 * the same host, but the contract and unit registry would be duplicated for no
 * reason.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "es2022",
  clean: true,
  // No sourcemap. `noExternal` inlines two packages' worth of source, and the map
  // then references paths that do not exist beside `dist`, so vitest prints
  // "Sourcemap ... points to missing source files" on every run of every suite
  // that loads this. A harness is not something anyone steps through, and a
  // warning nobody can act on is worse than the stack frames it would have named.
  sourcemap: false,
  noExternal: [
    "@ksp-gonogo/core",
    "@ksp-gonogo/data",
    "@ksp-gonogo/logger",
    "@ksp-gonogo/sitrep-client",
  ],
  // Peers and the PUBLISHED gonogo packages: resolved from the consumer's tree,
  // never bundled. Anything holding a module-level registry has to be external or
  // there are two of them.
  //
  // `@ksp-gonogo/ui-kit` is the one that bit: it owns the AUGMENT registry, and
  // inlining it here meant `registerAugment` wrote to the bundled copy while the
  // widget's `<AugmentSlot>` read the real one. No error, no warning, the augment
  // simply never rendered and sixteen Scansat tests asserted on an empty div.
  // styled-components is the same hazard one layer down: a second copy produces
  // components that silently do not share a ThemeProvider with the host app's.
  external: [
    "@ksp-gonogo/sitrep-sdk",
    "@ksp-gonogo/ui-kit",
    "@testing-library/react",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "styled-components",
  ],
  dts: {
    resolve: true,
  },
});
