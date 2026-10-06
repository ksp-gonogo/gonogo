import type { SitrepUnit } from "./__generated__/units";
import type { Value as ModelValue, Vector3 } from "./unit-system";

// The generated contract imports Value from here; it is the unit model's Value under the contract's unit union.
export type Value<Unit extends SitrepUnit = SitrepUnit> = ModelValue<Unit>;

/**
 * A vector whose three components are `Value`s in one unit:
 * `Vec3Of<"m">` for a position, `Vec3Of<"m/s">` for a velocity. A position
 * cannot be passed where a velocity is expected. {@link vectorMagnitude}
 * returns its length.
 *
 * @category Units and values
 */
export type Vec3Of<Unit extends SitrepUnit = SitrepUnit> = Vector3<Unit>;
