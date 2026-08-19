/**
 * The screen context moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * `Screen` is a member of the setting and settings-tab definitions an Uplink
 * registers, so it was already part of the published type surface by value while
 * living in a private package. It names nothing but React.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  type Screen,
  ScreenProvider,
  useScreen,
} from "@ksp-gonogo/sitrep-sdk/spine";
