import { value } from "@ksp-gonogo/sitrep-sdk";
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
  airTemp: number | null;
  skinTemp: number | null;
}) {
  return (
    <div role="status" aria-live="polite" style={LIVE_CHIP_STYLE}>
      <div style={CHIP_ROW_STYLE}>
        <span style={CHIP_LABEL_STYLE}>ρ</span>
        <span style={CHIP_VALUE_STYLE}>
          <Unit value={density} decimals={3} />
        </span>
      </div>
      {airTemp !== null && (
        <div style={CHIP_ROW_STYLE}>
          <span style={CHIP_LABEL_STYLE}>Air</span>
          <span style={CHIP_VALUE_STYLE}>
            <TempC k={airTemp} />
          </span>
        </div>
      )}
      {skinTemp !== null && (
        <div style={CHIP_ROW_STYLE}>
          <span style={CHIP_LABEL_STYLE}>Skin</span>
          <span style={CHIP_VALUE_STYLE}>
            <TempC k={skinTemp} />
          </span>
        </div>
      )}
    </div>
  );
}

// Kelvin on the wire, Celsius on screen.
function TempC({ k }: { k: number }) {
  return <Unit value={value("K", k)} as="°C" />;
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
  border: "1px solid var(--color-surface-raised)",
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
