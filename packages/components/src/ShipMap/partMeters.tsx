import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { resourceColor, TONE_MARK } from "@ksp-gonogo/ui-kit";
import type React from "react";
import type { ScreenBox } from "./partOverlays";
import type { ShipMapPart, ShipMapPartMeterEntry } from "./shipTopology";

/** Empty per-part meter list, shared so a lookup miss doesn't allocate. */
export const NO_METERS: readonly ShipMapPartMeterEntry[] = [];

/**
 * Status as a tint on the meter's track or outline, never a fill hue: the fill is
 * the resource's identity colour, so resource and condition stay separately
 * legible.
 */
export const METER_STATUS_COLOR: Record<"low" | "critical", string> = {
  low: "var(--color-warn-mark)",
  critical: "var(--color-nogo-mark)",
};

/**
 * The quantity a part-meter row carries, on either value-bearing arm: this
 * site draws a fill bar, so a held figure is still drawn.
 */
function quantityOf(
  figure: Value<"units"> | Reading<Value<"units">>,
): Value<"units"> | undefined {
  if (!("state" in figure)) return figure;
  return figure.state === "observed" || figure.state === "held"
    ? figure.value
    : undefined;
}

function isHeldFigure(
  figure: Value<"units"> | Reading<Value<"units">>,
): boolean {
  return "state" in figure && figure.state === "held";
}

/**
 * Whether either figure of a row is the last one there was rather than the
 * tank now. Only a contributor that sends the whole reading can say so; a bare
 * quantity claims nothing about when it was read.
 */
function isHeld(row: ShipMapPartMeterEntry): boolean {
  return isHeldFigure(row.amount) || isHeldFigure(row.capacity);
}

/** Whether any row on the diagram has a held capacity, so the hatch pattern is only defined when something draws it. */
export function anyMeterHeld(
  partMeters: ReadonlyMap<string, readonly ShipMapPartMeterEntry[]> | undefined,
): boolean {
  if (!partMeters) return false;
  for (const rows of partMeters.values()) {
    if (rows.some((row) => isHeldFigure(row.capacity))) return true;
  }
  return false;
}

/**
 * The hatch a held row's unfilled track is drawn with: the kit Meter's held
 * hatch as an SVG pattern, a 1px line every 4px at 45 degrees in the held
 * mark's hue. Sized against the camera zoom so the density on screen matches
 * the kit's. Static, so there is no motion to reduce.
 */
export function HeldHatchPattern({ id, zoom }: { id: string; zoom: number }) {
  const period = 4 / zoom;
  return (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={period}
      height={period}
      patternTransform="rotate(45)"
    >
      <rect width={1 / zoom} height={period} fill={TONE_MARK.warn} />
    </pattern>
  );
}

/**
 * The fill, 0..1. `dividedBy` checks the two are the same kind, so the
 * magnitude taken is already dimensionless; an SVG length cannot hold a unit.
 */
function fillRatio(row: ShipMapPartMeterEntry): number | null {
  const amount = quantityOf(row.amount);
  const capacity = quantityOf(row.capacity);
  if (!amount || !capacity || !capacity.isPositive()) return null;
  return Math.max(0, Math.min(1, amount.dividedBy(capacity).magnitude));
}

/**
 * The compact in-body fill bars, one segment per contributed meter, as raw
 * SVG rects. `ShipDiagram`'s tooltip renders the same entries through `<Meter>`.
 */
export function renderResourceFill(
  meters: readonly ShipMapPartMeterEntry[],
  box: ScreenBox,
  heldHatchId: string,
): React.ReactNode {
  const drainable = meters.filter((m) => fillRatio(m) !== null);
  if (drainable.length === 0) return null;

  const padX = Math.max(2, box.w * 0.18);
  const padY = Math.max(2, box.h * 0.08);
  const innerW = box.w - padX * 2;
  const innerH = box.h - padY * 2;
  if (innerW <= 0 || innerH <= 0) return null;
  const gap = 1;
  const barW = (innerW - gap * (drainable.length - 1)) / drainable.length;
  if (barW <= 0) return null;

  return (
    <g pointerEvents="none">
      {drainable.map((m, i) => {
        const ratio = fillRatio(m) ?? 0;
        const fillH = innerH * ratio;
        const barX = box.x + padX + i * (barW + gap);
        const barTop = box.y + padY + (innerH - fillH);
        // Status tints the track, never the fill, which is always the resource's identity colour.
        const statusBorder = m.status
          ? METER_STATUS_COLOR[m.status]
          : undefined;
        // The kit Meter's rule: a held capacity hatches the unfilled part of the track, a held amount dims the fill.
        const trackHeld = isHeldFigure(m.capacity);
        const fillHeld = isHeldFigure(m.amount);
        return (
          <g key={m.resource}>
            <rect
              x={barX}
              y={box.y + padY}
              width={barW}
              height={innerH}
              fill="var(--color-surface-raised)"
              opacity={0.35}
              stroke={statusBorder}
              strokeWidth={statusBorder ? 1 : 0}
              strokeOpacity={0.9}
            />
            <rect
              x={barX}
              y={barTop}
              width={barW}
              height={fillH}
              fill={resourceColor(m.resource)}
              opacity={fillHeld ? 0.4 : 0.85}
            />
            {trackHeld && innerH - fillH > 0 && (
              <rect
                data-held-hatch=""
                x={barX}
                y={box.y + padY}
                width={barW}
                height={innerH - fillH}
                fill={`url(#${heldHatchId})`}
                opacity={0.55}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

export function partAriaLabel(
  p: ShipMapPart,
  meters: readonly ShipMapPartMeterEntry[] = NO_METERS,
): string {
  const name = p.title || p.name;
  const bits: string[] = [name, p.type, `${p.dryMass.toFixed(2)} tonnes`];
  for (const m of meters) {
    const ratio = fillRatio(m);
    if (ratio === null) continue;
    bits.push(
      `${m.displayName} ${Math.round(ratio * 100)} percent${isHeld(m) ? ", held" : ""}`,
    );
  }
  const maxK = p.maxTemperatureK ?? p.maxTemp;
  if (p.temperatureK !== undefined && maxK > 0) {
    const ratio = p.temperatureK / maxK;
    if (ratio > 0.75) bits.push("hot");
  }
  return bits.join(", ");
}
