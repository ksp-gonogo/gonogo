/**
 * An Uplink's unit, checked through every surface a first-party unit is, beside a
 * first-party unit of the same shape.
 *
 * Two pairs, one per shape. `fuel:u` sits on a ladder of its own the way `m` sits
 * on `length`; `fuel:mix` climbs nothing the way `rad` climbs nothing. Each
 * assertion is written for both members of its pair, so a surface that treats the
 * Uplink unit differently fails here rather than in an Uplink's build.
 *
 * Compiled by `tsconfig.test-d.json`, `@ts-expect-error` lines included: a line
 * that stops erroring fails the build.
 */

import {
  registerUnit,
  type UnitDeclarations,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import type { GENERATED_UNIT_KINDS } from "./__generated__/unit-kinds";
import { Band } from "./Band";
import { Meter } from "./Meter";
import { Unit } from "./Unit";
import { UnitSharedFormat } from "./UnitSharedFormat";
import {
  type FormatsFor,
  type KindOfGroup,
  type LADDERS,
  type LadderName,
  type PresentableAs,
  speakQuantity,
  type UnitGroupKey,
} from "./units";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    "fuel:u": {
      kind: "fuelAmount";
      dim: { readonly fuel: 1 };
      ratio: 1;
      ladder: "fuel";
    };
    "fuel:ku": {
      kind: "fuelAmount";
      dim: { readonly fuel: 1 };
      ratio: 1000;
      ladder: "fuel";
    };
    "fuel:mix": { kind: "mixture"; dim: { readonly mix: 1 }; ratio: 1 };
    "fuel:pct": { kind: "mixture"; dim: { readonly mix: 1 }; ratio: 0.01 };
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ── Registration is typed from the declaration ──────────────────────────────
registerUnit({
  symbol: "fuel:u",
  kind: "fuelAmount",
  dimension: { fuel: 1 },
  ratio: 1,
  ladder: "fuel",
  rungs: [
    { from: 0, symbol: "fuel:u", per: 1 },
    { from: 1e3, symbol: "fuel:ku", per: 1e3 },
  ],
});
registerUnit({
  symbol: "fuel:mix",
  kind: "mixture",
  dimension: { mix: 1 },
  ratio: 1,
});

registerUnit({
  symbol: "fuel:pct",
  // @ts-expect-error: the declaration says a mixture
  kind: "fuelAmount",
  dimension: { mix: 1 },
  ratio: 0.01,
});

// @ts-expect-error: `fuel:ku` is declared on the fuel ladder, so it must say so
registerUnit({
  symbol: "fuel:ku",
  kind: "fuelAmount",
  dimension: { fuel: 1 },
  ratio: 1000,
});

// @ts-expect-error: nothing declares `fuel:drum`
registerUnit({ symbol: "fuel:drum", kind: "x", dimension: {}, ratio: 1 });

// ── Kind lookup: a format's accepted set is the unit's kind ─────────────────
export type _formatsLaddered = Expect<
  Equal<FormatsFor<"fuel:u">, "fuel:u" | "fuel:ku">
>;
// Written as an inclusion and an exclusion rather than an equality, because a unit
// test elsewhere in this package declares a length of its own.
type Lengths = "m" | "km" | "Mm" | "Gm" | "Tm";
export type _formatsLadderedFirstParty = Expect<
  Equal<Extract<FormatsFor<"Mm">, Lengths>, Lengths>
>;
export type _formatsLadderedFirstPartyOnlyLengths = Expect<
  Equal<Extract<FormatsFor<"Mm">, "fuel:u" | "rad" | "kg">, never>
>;
export type _formatsFlat = Expect<
  Equal<FormatsFor<"fuel:mix">, "fuel:mix" | "fuel:pct">
>;
export type _formatsFlatFirstParty = Expect<
  Equal<FormatsFor<"rad">, "rad" | "°">
>;
export type _presentableFlat = Expect<
  Equal<PresentableAs<"fuel:pct">, "fuel:mix" | "fuel:pct">
>;

// ── Ladders and pin groups ──────────────────────────────────────────────────
export type _ladderNamed = Expect<Equal<Extract<LadderName, "fuel">, "fuel">>;
export type _ladderNamedFirstParty = Expect<
  Equal<Extract<LadderName, "length">, "length">
>;
export type _groupOfLadder = Expect<Equal<KindOfGroup<"fuel">, "fuelAmount">>;
export type _groupOfLadderFirstParty = Expect<
  Equal<KindOfGroup<"length">, "length">
>;
export type _groupOfFlat = Expect<Equal<KindOfGroup<"fuel:mix">, "mixture">>;
export type _groupOfFlatFirstParty = Expect<
  Equal<KindOfGroup<"rad">, "planeAngle">
>;
// A unit on a ladder is not a group of its own, on either side.
export type _ladderedUnitIsNoKey = Expect<
  Equal<Extract<UnitGroupKey, "fuel:u" | "m">, never>
>;
export type _flatUnitIsAKey = Expect<
  Equal<Extract<UnitGroupKey, "fuel:mix" | "rad">, "fuel:mix" | "rad">
>;

// ── <Unit> ──────────────────────────────────────────────────────────────────
const fuel = value("fuel:u", 2_400);
const mix = value("fuel:mix", 0.4);
const altitude = value("m", 12_400);
const angle = value("rad", 0.4);

export const _unitFormat = <Unit value={fuel} format="fuel:ku" />;
export const _unitFormatFirstParty = <Unit value={altitude} format="km" />;
export const _unitAs = <Unit value={mix} as="fuel:pct" />;
export const _unitAsFirstParty = <Unit value={angle} as="°" />;

// @ts-expect-error: a mixture is not an amount of fuel
export const _unitWrongKind = <Unit value={fuel} format="fuel:pct" />;
// @ts-expect-error: a plane angle is not a length
export const _unitWrongKindFirstParty = <Unit value={altitude} format="rad" />;
// @ts-expect-error: a length is not a mixture
export const _unitWrongAs = <Unit value={mix} as="m" />;
// @ts-expect-error: a mixture is not a plane angle
export const _unitWrongAsFirstParty = <Unit value={angle} as="fuel:pct" />;

// ── <UnitSharedFormat> ──────────────────────────────────────────────────────
export const _pins = (
  <UnitSharedFormat
    pins={{
      fuel: { format: "fuel:ku" },
      length: { format: "km" },
      "fuel:mix": { as: "fuel:pct" },
      rad: { as: "°" },
    }}
  >
    <Unit value={fuel} />
    <Unit value={altitude} />
  </UnitSharedFormat>
);

export const _pinsWrongKind = (
  <UnitSharedFormat
    pins={{
      // @ts-expect-error: the fuel ladder does not climb to a length
      fuel: { format: "km" },
      // @ts-expect-error: the length ladder does not climb to fuel
      length: { format: "fuel:ku" },
    }}
  >
    <Unit value={fuel} />
  </UnitSharedFormat>
);

export const _pinsUnitKeyRefused = (
  <UnitSharedFormat
    // @ts-expect-error: `fuel:u` is a unit of the fuel group, not a group
    pins={{ "fuel:u": { format: "fuel:ku" } }}
  >
    <Unit value={fuel} />
  </UnitSharedFormat>
);

export const _pinsUnitKeyRefusedFirstParty = (
  <UnitSharedFormat
    // @ts-expect-error: `m` is a unit of the length group, not a group
    pins={{ m: { format: "km" } }}
  >
    <Unit value={altitude} />
  </UnitSharedFormat>
);

export const _scopeOf = (
  <UnitSharedFormat of="fuel:u" format="fuel:ku">
    <Unit value={fuel} />
  </UnitSharedFormat>
);

export const _scopeOfWrongKind = (
  // @ts-expect-error: a scope over fuel cannot be read as a mixture
  <UnitSharedFormat of="fuel:u" as="fuel:pct">
    <Unit value={fuel} />
  </UnitSharedFormat>
);

// ── <Band> and <Meter> ──────────────────────────────────────────────────────
export const _band = (
  <Band
    min={value("fuel:u", 900)}
    max={value("fuel:ku", 1.2)}
    format="fuel:ku"
  />
);
export const _bandFirstParty = (
  <Band min={value("m", 900)} max={value("km", 1.2)} format="km" />
);
export const _bandWrongKind = (
  <Band
    min={value("fuel:u", 900)}
    max={value("fuel:ku", 1.2)}
    // @ts-expect-error: a band of fuel is not a length
    format="m"
  />
);

export const _meter = (
  <Meter
    label="Fuel"
    quantity={{ amount: fuel, capacity: value("fuel:ku", 4) }}
    format="fuel:ku"
  />
);
export const _meterFirstParty = (
  <Meter
    label="Range"
    quantity={{ amount: altitude, capacity: value("km", 40) }}
    format="km"
  />
);
export const _meterWrongKind = (
  <Meter
    label="Fuel"
    quantity={{ amount: fuel, capacity: value("fuel:ku", 4) }}
    // @ts-expect-error: a fuel meter is not read in metres
    format="m"
  />
);

// ── speakQuantity and arithmetic ────────────────────────────────────────────
export const _spoken: string = speakQuantity(fuel);
export const _spokenFirstParty: string = speakQuantity(altitude);

export const _sum: Value<"fuel:u"> = fuel.plus(value("fuel:ku", 1));
export const _sumFirstParty: Value<"m"> = altitude.plus(value("km", 1));
// @ts-expect-error: fuel does not add to a length
export const _sumWrongDimension = fuel.plus(altitude);

// ── The runtime table says what the declarations say ────────────────────────
// ui-kit's generated table is the RUNTIME copy of the first-party declarations.
// Every symbol in it is declared, with the same kind and the same ladder, and its
// ladders are exactly the ones the kit carries rungs for.
type Generated = typeof GENERATED_UNIT_KINDS;
type LadderOf<T> = T extends { ladder: infer L } ? L : never;
type Disagreements = {
  [S in keyof Generated]: S extends keyof UnitDeclarations
    ? Equal<Generated[S]["kind"], UnitDeclarations[S]["kind"]> extends true
      ? Equal<
          LadderOf<Generated[S]>,
          LadderOf<UnitDeclarations[S]>
        > extends true
        ? never
        : S
      : S
    : S;
}[keyof Generated];
export type _runtimeTableAgrees = Expect<Equal<Disagreements, never>>;
export type _firstPartyLaddersHaveRungs = Expect<
  Equal<
    { [S in keyof Generated]: LadderOf<Generated[S]> }[keyof Generated],
    keyof typeof LADDERS
  >
>;
