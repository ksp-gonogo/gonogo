/**
 * Binds the project's theme contract onto styled-components' `DefaultTheme`,
 * so every `${({ theme }) => theme.space.md}` callback in this package is
 * typed rather than `any`-adjacent.
 *
 * ## Why this lives here, and not in `@ksp-gonogo/theme`
 *
 * A `declare module` augmentation only applies where TypeScript compiles it
 * **from source**. It cannot be shipped through a built `.d.ts`: an
 * augmentation needs an import of its target resolvable in the same file, and
 * the `import type {} from "styled-components"` that provides that resolution
 * is type-only, so `tsc` elides it from the emitted declaration. A consumer
 * then reads an augmentation whose target no longer resolves, and it silently
 * does nothing — no error, just `Property 'space' does not exist on type
 * 'DefaultTheme'` somewhere far away.
 *
 * The augmentation therefore has to be compiled as source by whoever needs it.
 * That is only this package: ui-kit's layout primitives (`Box`, `Cluster`,
 * `Grid`, `Inline`, `Stack`) are the workspace's only readers of a typed
 * `theme` in a styled callback. Everyone else consumes finished components and
 * never touches `DefaultTheme`, so nothing is lost by scoping it here.
 *
 * This file is included by `tsconfig.json`'s `include: ["src"]` and needs no
 * import anywhere to take effect — being in the program is what applies it.
 * It is deliberately absent from `index.ts`: it has no runtime surface to
 * export, and exporting it would imply consumers inherit the augmentation,
 * which is exactly the false promise this replaces.
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
