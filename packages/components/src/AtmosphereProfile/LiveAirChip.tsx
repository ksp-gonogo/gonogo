import { Unit } from "@ksp-gonogo/ui-kit";
import type { ComponentProps } from "react";

type UnitValue = ComponentProps<typeof Unit>["value"];

/** The air around the craft now: density, then air and skin temperature where each arrived. */
export function LiveAirChip({
  density,
  airTemp,
  skinTemp,
}: {
  density: UnitValue;
  airTemp: UnitValue;
  skinTemp: UnitValue;
}) {
  return (
    <div role="status" aria-live="polite" style={LIVE_CHIP_STYLE}>
      <div style={CHIP_ROW_STYLE}>
        <span style={CHIP_LABEL_STYLE}>ρ</span>
        <span style={CHIP_VALUE_STYLE}>
          <Unit value={density} decimals={3} />
        </span>
      </div>
      {hasFigure(airTemp) && (
        <div style={CHIP_ROW_STYLE}>
          <span style={CHIP_LABEL_STYLE}>Air</span>
          <span style={CHIP_VALUE_STYLE}>
            <Unit value={airTemp} as="°C" />
          </span>
        </div>
      )}
      {hasFigure(skinTemp) && (
        <div style={CHIP_ROW_STYLE}>
          <span style={CHIP_LABEL_STYLE}>Skin</span>
          <span style={CHIP_VALUE_STYLE}>
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

/* A positioned HUD chip over the chart's tick band; no ui-kit primitive for it. */
const LIVE_CHIP_STYLE = {
  position: "absolute",
  bottom: 32,
  right: 8,
  zIndex: 1,
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
  padding: "var(--inset-surface)",
  background: "rgba(0, 0, 0, 0.75)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
  fontSize: "var(--font-size-compact)",
  fontVariantNumeric: "tabular-nums",
  pointerEvents: "none",
} as const;

const CHIP_ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: "28px auto",
  gap: "var(--gap-related)",
  alignItems: "baseline",
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
