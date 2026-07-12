/**
 * Typed theme contract.
 *
 * The interfaces and the `styled-components` `DefaultTheme` augmentation live
 * in `@ksp-gonogo/ui-kit` (the export-safe design system). Core re-exports the
 * types so existing `@ksp-gonogo/core` consumers keep resolving them, and so
 * anything importing core transitively pulls in the augmentation. This is a
 * pure `export type` — fully erased at build time, so core gains no runtime
 * edge to the kit (the dependency is one-directional: core → kit).
 *
 * `GonogoTheme` is kept as an alias of the kit's `UiKitTheme` so `types.ts` and
 * the theme packs compile without a rename sweep.
 */
export type {
  ThemeBorders,
  ThemeColors,
  ThemeRadii,
  ThemeSpace,
  ThemeTypography,
  UiKitTheme,
  UiKitTheme as GonogoTheme,
} from "@ksp-gonogo/ui-kit";
