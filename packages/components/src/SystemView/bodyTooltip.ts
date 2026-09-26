import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import type { CelestialBody } from "./useCelestialBodies";

/** The hovered body's facts, one row per fact the catalogue carries. */
export function tooltipRows(
  c: CelestialBody,
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (c.radius)
    rows.push({ label: "Radius", value: writeQuantity(value("m", c.radius)) });
  if (c.semiMajorAxis)
    rows.push({
      label: "SMA",
      value: writeQuantity(value("m", c.semiMajorAxis)),
    });
  if (c.eccentricity !== null && c.eccentricity !== undefined)
    rows.push({ label: "Ecc", value: c.eccentricity.toFixed(3) });
  if (c.inclination !== null && c.inclination !== undefined)
    rows.push({
      label: "Inc",
      value: writeQuantity(value("°", c.inclination), { decimals: 1 }),
    });
  if (c.period)
    rows.push({ label: "Period", value: writeQuantity(value("s", c.period)) });
  if (c.soi)
    rows.push({ label: "SoI", value: writeQuantity(value("m", c.soi)) });
  if (c.hasAtmosphere) rows.push({ label: "Atmos", value: "yes" });
  return rows;
}

/** Keeps the tooltip inside the container, flipping it to the cursor's other side near an edge. */
export function clampTooltipX(px: number, max: number | undefined): number {
  if (max === undefined) return px;
  return px > max - 220 ? Math.max(0, px - 220 - 24) : px;
}
export function clampTooltipY(py: number, max: number | undefined): number {
  if (max === undefined) return py;
  return py > max - 160 ? Math.max(0, max - 160 - 8) : py;
}
