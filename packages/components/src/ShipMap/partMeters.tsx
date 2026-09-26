import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { resourceColor } from "@ksp-gonogo/ui-kit";
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
  low: "var(--color-status-warning-bg)",
  critical: "var(--color-status-nogo-bg)",
};

/**
 * The quantity a part-meter row carries, on either value-bearing arm: this
 * site draws a fill bar, so a held figure is still drawn.
 */
function quantityOf(
  figure: Value<"units"> | Reading<Value<"units">>,
): Value<"units"> | undefined {
  if (!("state" in figure)) return figure;
  return figure.state === "observed" || figure.state === "stale"
    ? figure.value
    : undefined;
}

/**
 * Whether a row's level is the last one there was rather than the tank now.
 * Only a contributor that sends the whole reading can say so; a bare quantity
 * claims nothing about when it was read.
 */
function isHeld(row: ShipMapPartMeterEntry): boolean {
  return "state" in row.amount && row.amount.state === "stale";
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
        // A held level is drawn faded inside a dashed track: still the last level there was, and visibly not the tank now.
        const held = isHeld(m);
        return (
          <g key={m.resource}>
            <rect
              x={barX}
              y={box.y + padY}
              width={barW}
              height={innerH}
              fill="var(--color-surface-raised)"
              opacity={0.35}
              stroke={
                statusBorder ?? (held ? "var(--color-text-muted)" : undefined)
              }
              strokeWidth={statusBorder || held ? 1 : 0}
              strokeDasharray={held ? "2 1" : undefined}
              strokeOpacity={0.9}
            />
            <rect
              x={barX}
              y={barTop}
              width={barW}
              height={fillH}
              fill={resourceColor(m.resource)}
              opacity={held ? 0.4 : 0.85}
            />
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
