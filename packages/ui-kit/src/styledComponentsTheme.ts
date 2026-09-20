/**
 * Binds the project's theme contract onto styled-components' `DefaultTheme`,
 * so a consumer's `${({ theme }) => theme.colors.text.primary}` callback is
 * typed rather than `any`-adjacent.
 *
 * It is entirely for consumers now. This package's own primitives read nothing
 * off the styled-components context: colour goes through `var(--color-*)` and
 * size through the maps in `scales.ts`, so the augmentation has no local call
 * site left to prove it works.
 *
 * ## Why this lives here, and not in `@ksp-gonogo/theme`
 *
 * A `declare module` augmentation only applies where TypeScript compiles it
 * from source, or where it reaches a consumer in a `.d.ts` that still contains
 * a resolvable reference to the augmentation target. `@ksp-gonogo/theme` is
 * `private: true` and never published: the kit inlines it: so an
 * augmentation living there would reach nobody. It belongs here, in the
 * package that actually ships.
 *
 * ## Why `index.ts` imports this file
 *
 * The import looks pointless: this module has no runtime surface, and the
 * bundler correctly emits zero bytes for it. It is load-bearing for *types*:
 *
 * `tsc --noEmit` picks the file up via `include: ["src"]` whether or not
 * anything imports it. The **`dts` build does not**: it builds its program from
 * the entry graph, so without the import this module drops out and the emitted
 * `.d.ts` carries no augmentation at all.
 *
 * That failure is now SILENT here. While the primitives still read `theme.space`
 * the declaration build went red on `Property 'space' does not exist on type
 * 'DefaultTheme'`; they no longer do, so dropping the import costs a consumer
 * their typed theme with nothing going red in this repo. Do not "clean it up".
 *
 * ## It does survive emit, verified
 *
 * An earlier iteration of this file claimed an augmentation can never ship
 * through a built `.d.ts`, because the `import type {} from "styled-components"`
 * that makes `declare module` an *augmentation* rather than an ambient
 * declaration is elided by `tsc`. That is true of a **standalone** emitted
 * file, and it is why the pre-bundler `tsc` build shipped a dead augmentation.
 *
 * It is not true of the bundled `dist/index.d.ts` this package now emits. The
 * rolled-up declaration carries real value imports of `styled-components`
 * (the components' own prop types need them), so the module reference resolves
 * in-file and the augmentation binds. Confirmed against a packed tarball
 * installed into a clean project: `theme.colors.text.primary` typechecks, and
 * `theme.colors.text.bogus` errors with `Property 'bogus' does not exist`.
 * Consumers inherit the typed theme: which is what a design system should do.
 *
 * The load-bearing part is the *bundled* emit. Reverting to a plain `tsc`
 * build, or splitting this into its own entry, silently returns it to a dead
 * augmentation: the failure mode is a consumer's `theme.x` going `any`, with
 * nothing going red here.
 */

import type { UiKitTheme } from "@ksp-gonogo/theme";
// Type-only import of the augmentation target: without a reference to
// "styled-components" in this file, `declare module` below would be read as a
// declaration of a new ambient module rather than an augmentation of the
// installed one.
import type {} from "styled-components";

declare module "styled-components" {
  export interface DefaultTheme extends UiKitTheme {}
}
