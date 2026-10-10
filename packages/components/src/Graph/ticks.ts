import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, writeQuantity } from "@ksp-gonogo/ui-kit";

export function formatReadoutValue(v: number): string {
  if (!Number.isFinite(v)) return NULL_DISPLAY;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}k`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

/** An axis tick on a known unit, written by the unit registry: the k/M suffixer would turn 2000 m/s into "2.0km/s", a different quantity. A string because SVG `<text>` cannot hold a `<Unit>` span. */
export function unitTick(
  unit: string,
  magnitude: number,
  ticks?: readonly number[],
): string {
  // A tick a hair from zero is zero: it would otherwise read "-0 m".
  const at = ticks && isZeroTick(magnitude, ticks) ? 0 : magnitude;
  return writeQuantity(value(unit as never, at), {
    decimals: ticks ? exactDecimals(unit, at, ticks) : 0,
  });
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

function numericTickText(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

export function formatNumericTick(v: number, unit?: string): string {
  const text = numericTickText(v);
  return unit ? `${text}${unit}` : text;
}
