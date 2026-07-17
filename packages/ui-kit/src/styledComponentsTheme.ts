/**
 * Binds the project's theme contract onto styled-components' `DefaultTheme`,
 * so every `${({ theme }) => theme.space.md}` callback is typed rather than
 * `any`-adjacent — for this package's own primitives *and* for consumers of
 * the published kit.
 *
 * ## Why this lives here, and not in `@ksp-gonogo/theme`
 *
 * A `declare module` augmentation only applies where TypeScript compiles it
 * from source, or where it reaches a consumer in a `.d.ts` that still contains
 * a resolvable reference to the augmentation target. `@ksp-gonogo/theme` is
 * `private: true` and never published — the kit inlines it — so an
 * augmentation living there would reach nobody. It belongs here, in the
 * package that actually ships.
 *
 * ## Why `index.ts` imports this file
 *
 * The import looks pointless — this module has no runtime surface, and the
 * bundler correctly emits zero bytes for it. It is load-bearing for *types*:
 *
 *  - `tsc --noEmit` (lint/typecheck) picks the file up via `include: ["src"]`
 *    whether or not anything imports it, so the primitives typecheck locally.
 *  - The **`dts` build does not**. It builds its program from the entry graph,
 *    not from tsconfig's `include`. Without the import, `styledComponentsTheme`
 *    drops out of that program and the declaration build fails outright with
 *    `Property 'space' does not exist on type 'DefaultTheme'` in `Box`/`Stack`.
 *
 * So the import is what keeps `pnpm build` green. Do not "clean it up".
 *
 * ## It does survive emit — verified
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
 * installed into a clean project: `theme.space.md` typechecks, and
 * `theme.space.bogus` errors with `Property 'bogus' does not exist on type
 * 'ThemeSpace'`. Consumers inherit the typed theme — which is what a design
 * system should do.
 *
 * The load-bearing part is the *bundled* emit. Reverting to a plain `tsc`
 * build, or splitting this into its own entry, silently returns it to a dead
 * augmentation — the failure mode is a consumer's `theme.x` going `any`, with
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
