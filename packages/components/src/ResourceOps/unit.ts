import type {
  IsruConverterEntry,
  IsruDrillEntry,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * One row of ResourceOps' list, tagged so a contributed filter can tell the
 * two kinds apart. The widget renders drills and converters in separate
 * sections but filters them as one set: an axis that only makes sense for
 * converters (a mod's own process identity) has to be able to reject a drill,
 * and one that spans both (a resource) has to see both.
 *
 * Lives in its own module rather than the widget file so the built-in
 * contribution can name it without importing the widget back.
 * `mod/sitrep-sdk/src/api/contribution-slots.ts` mirrors it for facade-sealed
 * Uplinks, the same way every other slot's context type is mirrored.
 */
export type ResourceOpsUnit =
  | { kind: "drill"; drill: IsruDrillEntry }
  | { kind: "converter"; converter: IsruConverterEntry };
