import { Unit } from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";

type UnitValue = ComponentProps<typeof Unit>["value"];

/**
 * The air around the craft now: density, then air and skin temperature where
 * each arrived. `stacked` puts each figure under its label, for a card with
 * little width, and `tight` shortens the labels and sets the figures small, for
 * a plot with room for little more than the figures themselves.
 */
export function LiveAirChip({
  density,
  airTemp,
  skinTemp,
  stacked = false,
  tight = false,
}: {
  density: UnitValue;
  airTemp: UnitValue;
  skinTemp: UnitValue;
  stacked?: boolean;
  tight?: boolean;
}) {
  const rowStyle = tight
    ? TIGHT_ROW_STYLE
    : stacked
      ? STACKED_ROW_STYLE
      : ROW_STYLE;
  const labelStyle = tight ? TIGHT_LABEL_STYLE : CHIP_LABEL_STYLE;
  const valueStyle = tight ? TIGHT_VALUE_STYLE : CHIP_VALUE_STYLE;
  return (
    <div role="status" aria-live="polite" style={LIVE_CHIP_STYLE}>
      <div style={rowStyle}>
        <span style={labelStyle}>{tight ? "Dens" : "Density"}</span>
        <span style={valueStyle}>
          <Unit value={density} decimals={tight ? 1 : 3} />
        </span>
      </div>
      {hasFigure(airTemp) && (
        <div style={rowStyle}>
          <span style={labelStyle}>Air</span>
          <span style={valueStyle}>
            <Unit value={airTemp} as="°C" />
          </span>
        </div>
      )}
      {hasFigure(skinTemp) && (
        <div style={rowStyle}>
          <span style={labelStyle}>Skin</span>
          <span style={valueStyle}>
            <Unit value={skinTemp} as="°C" />
          </span>
        </div>
      )}
    </div>
  );
}

/** Whether a temperature arrived as a number: a reading is asked of its value, so a held one still draws, marked. */
function hasFigure(input: UnitValue): boolean {
  const figure =
    input !== null && input !== undefined && "state" in input
      ? input.value
      : input;
  return figure !== null && figure !== undefined;
}

const LIVE_CHIP_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  fontSize: "var(--font-size-compact)",
  fontVariantNumeric: "tabular-nums",
} as const;

const ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: "7ch auto",
  gap: "var(--gap-related)",
  alignItems: "baseline",
} as const;

const TIGHT_ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: "4ch auto",
  gap: "var(--gap-line)",
  alignItems: "baseline",
} as const;

const TIGHT_LABEL_STYLE = {
  color: "var(--color-text-faint)",
  textTransform: "uppercase",
  fontSize: "var(--font-size-caption)",
} as const;

const TIGHT_VALUE_STYLE = {
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-compact)",
} as const;

const STACKED_ROW_STYLE = {
  display: "flex",
  flexDirection: "column",
} as const;

const CHIP_LABEL_STYLE = {
  color: "var(--color-text-faint)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontSize: "var(--font-size-caption)",
} as const;

const CHIP_VALUE_STYLE = {
  color: "var(--color-text-primary)",
  fontSize: "var(--font-size-value)",
} as const;
