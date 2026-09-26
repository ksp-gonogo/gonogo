/**
 * Binds the project's theme contract onto styled-components' `DefaultTheme`,
 * so a consumer's `${({ theme }) => theme.colors.text.primary}` callback is
 * typed. The kit's own primitives read nothing off the theme context.
 *
 * `index.ts` must import this file even though it emits no runtime bytes: the
 * `dts` build walks the entry graph, and without the import the emitted
 * `.d.ts` carries no augmentation, with nothing going red in this repo. The
 * augmentation survives emit only because the declaration output is bundled.
 */

import type { UiKitTheme } from "@ksp-gonogo/theme";
// Without this reference, `declare module` below would declare a new ambient module rather than augment the installed one.
import type {} from "styled-components";

declare module "styled-components" {
  export interface DefaultTheme extends UiKitTheme {}
}
