import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "../units";

/** An axis tick on a known unit, written by the unit registry: the k/M suffixer would turn 2000 m/s into "2.0km/s", a different quantity. A string because SVG `<text>` cannot hold a `<Unit>` span. */
export function unitTick(
  unit: string,
  magnitude: number,
  ticks?: readonly number[],
  scale: "linear" | "log" = "linear",
): string {
  // A tick a hair from zero is zero: it would otherwise read "-0 m".
  const at = ticks && isZeroTick(magnitude, ticks) ? 0 : magnitude;
  /*
   * Log ticks are powers of ten that share no step, so each is written with the
   * digits it needs: "10 mPa" beside "0.1 mPa", not "10.0 mPa" padded to the
   * finest tick's decimals.
   */
  const decimals = !ticks
    ? 0
    : scale === "log"
      ? decimalsFor(unit, at).decimals
      : exactDecimals(unit, at, ticks);
  return writeQuantity(value(unit as never, at), { decimals });
}

/** Whether a tick is zero, but for the rounding that put it there: far closer to zero than to its neighbours. */
function isZeroTick(magnitude: number, ticks: readonly number[]): boolean {
  const spacing = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0;
  return spacing > 0 && Math.abs(magnitude) < spacing * 1e-6;
}

/** The most decimals an axis tick is written with. */
const MAX_TICK_DECIMALS = 3;

/** A tick label's figure and the unit it is written in. */
function partsOf(label: string): { figure: number; unit: string } {
  return {
    figure: Number.parseFloat(label.replace(/[^\d.-]/g, "")),
    unit: label.replace(/[\d.,\s-]/g, ""),
  };
}

/** The fewest decimals that write this one tick exactly: more would change no figure. */
function decimalsFor(
  unit: string,
  tick: number,
): { decimals: number; unit: string } {
  const at = (decimals: number) =>
    partsOf(writeQuantity(value(unit as never, tick), { decimals }));
  const exact = at(MAX_TICK_DECIMALS);
  for (let decimals = 0; decimals < MAX_TICK_DECIMALS; decimals++) {
    if (at(decimals).figure === exact.figure)
      return { decimals, unit: exact.unit };
  }
  return { decimals: MAX_TICK_DECIMALS, unit: exact.unit };
}

/**
 * The decimals a tick on this axis is written with: the fewest that write exactly every tick in the same unit as it, so ticks in one unit read alike and none reads wrong. Fewer would write 1.5 km as "2 km", or two ticks the same.
 */
function exactDecimals(
  unit: string,
  magnitude: number,
  ticks: readonly number[],
): number {
  const own = decimalsFor(unit, magnitude);
  let decimals = own.decimals;
  for (const tick of ticks) {
    const other = decimalsFor(unit, tick);
    if (other.unit === own.unit) decimals = Math.max(decimals, other.decimals);
  }
  return decimals;
}

/** A quantity written to three significant figures, in the unit the kit settles on for its size: "478 Pa", "37.3 kPa", "1.21 kPa". A reading derived from a model carries no more than that. */
export function writeThreeFigures(quantity: {
  magnitude: number;
  unit: string;
}): string {
  const probe = partsOf(writeQuantity(quantity, { decimals: 3 }));
  const lead = Math.abs(probe.figure);
  const decimals =
    Number.isFinite(lead) && lead > 0
      ? Math.max(0, 2 - Math.floor(Math.log10(lead)))
      : 0;
  return writeQuantity(quantity, { decimals });
}
