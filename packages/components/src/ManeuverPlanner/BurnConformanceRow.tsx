import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  NULL_DISPLAY,
  Row,
  Stack,
  Text,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import type { BurnConformance, BurnConformancePhase } from "./conformance";

const CAPTION: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.04em",
};

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

/** One burn's delta-v conformance, as both figures: "180 of 300" is checkable at a glance, "120 remaining" is not. */
export function BurnConformanceRow({
  conformance,
}: {
  conformance: BurnConformance;
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
        text="Delivered delta-v against what the plan asked for. Independent of who planned the burn."
        focusable
      >
        <Stack style={{ alignItems: "flex-end", flex: "0 0 auto" }}>
          <Text size="sm" style={{ whiteSpace: "nowrap" }}>
            {conformance.deliveredDv == null ||
            conformance.plannedDv == null ? (
              NULL_DISPLAY
            ) : (
              <>
                <Unit
                  value={value("m/s", conformance.deliveredDv)}
                  decimals={1}
                />{" "}
                of{" "}
                <Unit
                  value={value("m/s", conformance.plannedDv)}
                  decimals={1}
                />
              </>
            )}
          </Text>
          <span style={{ ...CAPTION, whiteSpace: "nowrap" }}>
            {conformance.deliveredFraction == null ? (
              NULL_DISPLAY
            ) : (
              <Unit
                value={value("%", conformance.deliveredFraction * 100)}
                decimals={0}
              />
            )}
          </span>
        </Stack>
      </Tooltip>
    </Row>
  );
}
