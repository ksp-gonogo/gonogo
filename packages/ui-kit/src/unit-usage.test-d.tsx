/**
 * What the unit system looks like from a widget, compiled by
 * `tsconfig.test-d.json`. A `@ts-expect-error` line that stops erroring fails
 * the build.
 */

import {
  registerUnit,
  type Value,
  type Vec3Of,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Band } from "./Band";
import { Unit } from "./Unit";
import { UnitSharedFormat } from "./UnitSharedFormat";

// Stand-ins for the values `useTelemetry` hands a widget.
const altitude = value("m", 12_400);
const surfaceSpeed = value("m/s", 340);
const timeToApoapsis = value("s", 8_040);
const heatShieldFlux = value("kW", 3.4);
const funds = value("funds", 289_848);
const dryMass = value("t", 18.4);
const burnTime = value("s", 42);

// The call site names neither the unit nor the format.
export const _basic = <Unit value={altitude} />;

export const _precision = <Unit value={heatShieldFlux} decimals={1} />;
export const _pinned = <Unit value={surfaceSpeed} format="km/h" />;
export const _celsius = <Unit value={value("K", 300)} as="°C" />;

// A format of the wrong kind is a type error, not a wrong number on screen.
// @ts-expect-error: seconds are not a speed
export const _wrongKind = <Unit value={surfaceSpeed} format="s" />;

// @ts-expect-error: not a unit of any kind
export const _notAUnit = <Unit value={altitude} format="furlongs" />;

// `as` is checked the same way, since the formatter silently refuses a cross-kind conversion.
// @ts-expect-error: a length is not a mass
export const _wrongAsKind = <Unit value={altitude} as="kg" />;

// A ratio and a percent are different kinds; a ratio already renders as a percentage.
// @ts-expect-error: a ratio is not a percent
export const _ratioAsPercent = <Unit value={value("ratio", 0.42)} as="%" />;

// `of` is the unit a scope's pins are checked against. A `Band` passes its own unit down.
export const _band = (
  <Band min={value("m", 6_700_000)} max={value("m", 6_710_000)} format="km" />
);

export const _bandWrongKind = (
  <Band
    min={altitude}
    max={value("m", 13_000)}
    // @ts-expect-error: seconds are not a length
    format="s"
  />
);

export const _scopePinned = (
  <UnitSharedFormat of="m" format="km">
    <Unit value={altitude} />
  </UnitSharedFormat>
);

// The directive sits on the element: a failed overload is reported at the call, not the attribute.
export const _scopeWrongKind = (
  // @ts-expect-error: a scope over lengths cannot be read in kilograms
  <UnitSharedFormat of="m" as="kg">
    <Unit value={altitude} />
  </UnitSharedFormat>
);

// A mixed scope keys its pins by group, each checked against what that group measures.
export const _mixedScope = (
  <UnitSharedFormat pins={{ length: { format: "km" }, mass: { format: "t" } }}>
    <Unit value={altitude} />
    <Unit value={dryMass} />
  </UnitSharedFormat>
);

// The entry that is wrong is the one that errors, rather than the scope.
export const _mixedScopeSwapped = (
  <UnitSharedFormat
    pins={{
      // @ts-expect-error: a mass rung is not a length's
      length: { format: "t" },
      mass: { format: "kg" },
    }}
  >
    <Unit value={altitude} />
    <Unit value={dryMass} />
  </UnitSharedFormat>
);

// A ladder is keyed by its name, and a unit on one is not a key at all.
export const _mixedScopeUnitKeyRefused = (
  <UnitSharedFormat
    // @ts-expect-error: `m` is a unit of the length group, not a group
    pins={{ m: { format: "km" } }}
  >
    <Unit value={altitude} />
  </UnitSharedFormat>
);

// A unit that climbs nothing keys itself: `s` and `min` are one kind but two groups.
export const _mixedScopeUnladdered = (
  <UnitSharedFormat pins={{ s: { decimals: 1 } }}>
    <Unit value={burnTime} />
  </UnitSharedFormat>
);

// Pinning one group twice cannot be written: a duplicate key is TS1117 and a lint error.

// An entry may be left out entirely, and the group it would have pinned settles for itself.
export const _mixedScopePartial = (
  <UnitSharedFormat pins={{ length: { format: "km" } }}>
    <Unit value={altitude} />
    <Unit value={dryMass} />
  </UnitSharedFormat>
);

// Same dimension adds, converting as it goes: 42s + 2min is one duration.
export const _totalBurn = burnTime.plus(value("min", 2));

// Different dimensions do not.
// @ts-expect-error: a mass is not a duration
export const _nonsense = dryMass.plus(burnTime);

// Division derives the unit rather than being told it.
export const _acceleration = surfaceSpeed.per(burnTime); // m/s²
export const _fuelFlow = dryMass.per(burnTime); // kg/s

// Ordering converts first; comparing `.magnitude` directly would let the unit decide.
export const _isLong = burnTime.greaterThan(value("min", 1));
export const _sorted = [burnTime, value("min", 2)].sort((a, b) => a.compare(b));

// Sign needs no operand: zero is zero in every unit of a dimension.
export const _draining = value("units/s", -0.32).isNegative();
export const _drift = value("m", -14.2).abs();

// min/max convert first; Math.max via valueOf would return 90 min over 1 h.
export const _longer = value("h", 1).max(value("min", 90));

// A Value used as a bare number is a compile error.

// @ts-expect-error: a Value is not a ReactNode. This is the {value} in JSX case.
export const _rawInJsx = <span>{altitude}</span>;

// @ts-expect-error: arithmetic on an object type
export const _rawMaths = altitude + 1;

// @ts-expect-error: relational operator on an object type
export const _rawCompare = altitude > 1_000;

// @ts-expect-error: toFixed belongs to Number.prototype, and formatting is Unit's job
export const _rawFormat = altitude.toFixed(2);

// The unit-carrying form of each, in order:
export const _fixedJsx = (
  <span>
    <Unit value={altitude} />
  </span>
);
export const _fixedMaths = altitude.plus(value("m", 1));
export const _fixedCompare = altitude.greaterThan(value("m", 1_000));
export const _fixedFormat = <Unit value={altitude} decimals={2} />;

// valueOf is still there for the places a number is genuinely wanted: a chart axis, a progress bar, Math.max.
export const _axisMax: number = Math.max(
  altitude.valueOf(),
  value("m", 5_000).valueOf(),
);

// A duration is a unit like any other; Unit climbs time by 60s rather than 1000s.
export const _countdown = <Unit value={timeToApoapsis} />;

// A currency's glyph, spoken word and thousands separator all come from the model.
export const _funds = <Unit value={funds} />;

// A unit declared on a whole vector reaches x/y/z, so each leaf renders like any other quantity.
declare const relativeVelocity: Vec3Of<"m/s">;
export const _vectorLeaf = <Unit value={relativeVelocity.x} />;

// @ts-expect-error: a whole vector is not a scalar quantity
export const _wholeVector = <Unit value={relativeVelocity} />;

// An Uplink's own unit is namespaced, and a full participant: every check above applies to it.
declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    "snacks:snack": { kind: "snacks"; dim: { readonly snack: 1 }; ratio: 1 };
    "snacks:snack/s": {
      kind: "snackFlow";
      dim: { readonly snack: 1; readonly s: -1 };
      ratio: 1;
    };
  }
}

registerUnit({
  symbol: "snacks:snack",
  kind: "snacks",
  dimension: { snack: 1 },
  ratio: 1,
});
registerUnit({
  symbol: "snacks:snack/s",
  kind: "snackFlow",
  dimension: { snack: 1, s: -1 },
  ratio: 1,
});

const snacks = value("snacks:snack", 40);
export const _snackFlow = snacks.per(burnTime);
export const _snackReadout = <Unit value={snacks} />;

// @ts-expect-error: a snack is not a tonne, whatever the glyph looks like
export const _snacksPlusMass = snacks.plus(dryMass);

// The per-second unit is declared, so dividing by a duration lands on it by name.
export const _snackFlowUnit: Value<"snacks:snack/s"> = _snackFlow;
