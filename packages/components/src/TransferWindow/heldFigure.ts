import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { UnitValue } from "@ksp-gonogo/ui-kit";

/** When a figure's source was last a reading of now; `null` while it still is. */
export type HeldSince = Pick<Reading<unknown>, "asOfUt" | "grade"> | null;

/** A figure derived from a held source, handed to `Unit` as held so the kit marks it. */
export function heldFigure<Unit extends string>(
  figure: Value<Unit>,
  heldSince: HeldSince,
): UnitValue<Unit> {
  if (heldSince === null) return figure;
  return {
    state: "held",
    value: figure,
    asOfUt: heldSince.asOfUt,
    grade: heldSince.grade,
    reckoning: { status: "none" },
  };
}
