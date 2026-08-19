/**
 * The body registry moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * A planet pack is an Uplink's business: `registerBody` is how one adds or
 * overrides an entry and `registerStockBodies` is called by seven Uplink test
 * files, and neither was reachable from a published package. `getBody` was, as a
 * host shim, whose own doc made the argument for the move: a bundled copy of a
 * module-static map would read its own permanently-empty version. The state is a
 * `globalThis` slot now, so that failure is closed rather than routed around.
 *
 * The file named nothing but its own types, so nothing was holding it here.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  type AtmosphereModel,
  type BodyDefinition,
  type BodyMapConfig,
  clearBodies,
  getAllBodies,
  getBody,
  getImagingWindow,
  imagingQuality,
  registerBody,
} from "@ksp-gonogo/sitrep-sdk";
