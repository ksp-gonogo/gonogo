/*
 * The contract types live in the sdk, which ThemeDefinition.theme is typed
 * against and which the kit cannot be a dependency of. This module is the
 * theme package's own name for them.
 */
export type {
  ThemeBorders,
  ThemeColors,
  ThemeTypography,
  UiKitTheme,
} from "@ksp-gonogo/sitrep-sdk";
