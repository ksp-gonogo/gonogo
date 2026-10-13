import { type CarriedCurrency, datedFrom, value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Row, Text, Tooltip, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import type { BurnConformance, BurnConformancePhase } from "./conformance";

const PHASE_CHIP: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/** Categorical hues, not status colours: nothing on this row judges whether the burn went well. */
const PHASE: Record<BurnConformancePhase, { label: string; colour: string }> = {
  unknown: { label: "Not observed", colour: "var(--color-text-muted)" },
  "not-started": { label: "Not started", colour: "var(--color-data-1)" },
  "in-progress": { label: "Burning", colour: "var(--color-data-3)" },
  // Labelled for the observation, not the burn: a paused burn and an abandoned one read the same.
  "stopped-short": { label: "Thrust ceased", colour: "var(--color-data-2)" },
  delivered: { label: "Delivered", colour: "var(--color-data-5)" },
};

/** One burn's phase beside the delta-v the plan asks for. */
export function BurnConformanceRow({
  conformance,
  from,
}: {
  conformance: BurnConformance;
  /** The readings the plan was read from, so its figure carries their currency. */
  from: readonly CarriedCurrency[];
}) {
  const phase = PHASE[conformance.phase];
  return (
    <Row
      as="li"
      data-burn-conformance-row=""
      style={{ alignItems: "stretch", gap: "var(--gap-related)" }}
    >
      <span style={{ ...PHASE_CHIP, color: phase.colour, minWidth: 0 }}>
        {phase.label}
      </span>
      <Tooltip
        text="Delta-v the plan asks for, whoever planned the burn. The delta-v delivered is not reported."
        focusable
      >
        <Text size="sm" style={{ whiteSpace: "nowrap" }}>
          {conformance.plannedDv === null ? (
            NULL_DISPLAY
          ) : (
            <Unit
              value={datedFrom(from, value("m/s", conformance.plannedDv))}
              decimals={1}
            />
          )}
        </Text>
      </Tooltip>
    </Row>
  );
}
