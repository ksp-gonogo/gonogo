import { registerUnit, value } from "@ksp-gonogo/sitrep-sdk";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    "EC/s": {
      kind: "resourceFlow";
      dim: { readonly resource: 1; readonly s: -1 };
      ratio: 1;
    };
  }
}

/**
 * Electric charge per second, the short name for the one resource an operator
 * reads by its initials. Same quantity as units per second, so a figure in
 * either converts to the other; the tiny form draws it because a unit seven
 * letters long does not fit beside a signed figure in a three-column tile.
 */
registerUnit({
  symbol: "EC/s",
  kind: "resourceFlow",
  dimension: { resource: 1, s: -1 },
  ratio: 1,
  word: "electric charge per second",
});

/** A resource's net rate as a figure: electric charge in EC/s, any other resource in units per second. */
export function netRate(resource: string, net: number) {
  return resource === "ElectricCharge"
    ? value("EC/s", net)
    : value("units/s", net);
}
