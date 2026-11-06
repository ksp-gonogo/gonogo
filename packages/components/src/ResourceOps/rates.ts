import type {
  IsruConverterEntry,
  IsruDrillEntry,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";

/**
 * Enough decimal places to show a rate as nonzero: `base` for an ordinary
 * magnitude, widened to two significant digits below it, since life-support
 * rates sit around 0.0002 units/s and "0.000" reads as a dead process.
 */
export function rateDecimals(rate: Quantityish, base: number): number {
  const magnitude = magnitudeOf(rate);
  if (magnitude === null || magnitude === 0) return base;
  const twoSignificant = 1 - Math.floor(Math.log10(Math.abs(magnitude)));
  return Math.min(6, Math.max(base, twoSignificant));
}

/**
 * A switched-on drill or converter the game itself reports as achieving none of
 * its recipe (an input is missing), so the nominal rates beside it are not real.
 * False when the backend does not report the figure.
 */
export function reportedStarved(
  entry: IsruConverterEntry | IsruDrillEntry,
): boolean {
  if (entry.running !== true) return false;
  const throughput = entry.throughput;
  return throughput != null && !throughput.isPositive();
}

/**
 * Starved by the game's own figure, or, for a converter whose backend reports
 * none, running with outputs that all read zero. A drill with no figure is not.
 */
export function isStarved(entry: IsruConverterEntry | IsruDrillEntry): boolean {
  if (reportedStarved(entry)) return true;
  if (entry.running !== true || !("outputs" in entry)) return false;
  if (entry.throughput != null) return false;
  return (
    entry.outputs.length > 0 &&
    entry.outputs.every((flow) => flow.rate?.isZero() === true)
  );
}

/**
 * Net ElectricCharge draw across every running converter (inputs minus
 * outputs), the one cheap power aggregate the shared shape supports: drills
 * carry no EC field of their own. A positive number draws power; negative
 * means the fleet is a net generator (e.g. a running fuel cell).
 *
 * `moves` is a property of the recipes; `net` is `null` the moment one
 * contributing rate cannot be read, because a partial sum understates the draw.
 */
export function netElectricChargeDraw(
  converters: readonly IsruConverterEntry[],
): {
  moves: boolean;
  net: number | null;
} {
  let moves = false;
  let net: number | null = 0;
  for (const converter of converters) {
    for (const flow of converter.inputs) {
      if (flow.resource !== "ElectricCharge") continue;
      moves = true;
      if (converter.running !== true || reportedStarved(converter)) continue;
      const rate = magnitudeOf(flow.rate);
      net = rate === null || net === null ? null : net + rate;
    }
    for (const flow of converter.outputs) {
      if (flow.resource !== "ElectricCharge") continue;
      moves = true;
      if (converter.running !== true || reportedStarved(converter)) continue;
      const rate = magnitudeOf(flow.rate);
      net = rate === null || net === null ? null : net - rate;
    }
  }
  return { moves, net };
}

/** The resources a converter touches, both recipe sides, as a searchable run. */
export function converterResources(converter: IsruConverterEntry): string {
  return [...converter.inputs, ...converter.outputs]
    .map((flow) => flow.resource ?? "")
    .join(" ");
}
