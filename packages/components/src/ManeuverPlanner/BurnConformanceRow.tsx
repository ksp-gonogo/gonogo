import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  NULL_DISPLAY,
  Row,
  Stack,
  Text,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import type { BurnConformance, BurnConformancePhase } from "./conformance";

const CAPTION: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.04em",
};

const PHASE_CHIP: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/**
 * The phase's word, and a hue off the CATEGORICAL ramp rather than the status
 * palette. A shortfall is not modelled here (see `BurnConformancePhase`), so
 * nothing on this row is a judgement about whether the burn went WELL, and a
 * status colour would imply one.
 */
const PHASE: Record<BurnConformancePhase, { label: string; colour: string }> = {
  unknown: { label: "Not observed", colour: "var(--color-text-muted)" },
  "not-started": { label: "Not started", colour: "var(--color-data-1)" },
  "in-progress": { label: "Burning", colour: "var(--color-data-3)" },
  // "Thrust ceased", not "Stopped short", and the difference is the point. The
  // phase NAME is about the burn; the LABEL has to be about the observation,
  // because a burn paused to be re-planned and a burn abandoned produce the
  // same reading. "Stopped short" would put a shortfall in front of an operator
  // who may simply be about to carry on.
  "stopped-short": { label: "Thrust ceased", colour: "var(--color-data-2)" },
  delivered: { label: "Delivered", colour: "var(--color-data-5)" },
};

/**
 * One burn's delta-v conformance: what the plan asked for against what has gone
 * in.
 *
 * Both figures are shown rather than only the difference, because the difference
 * alone cannot be checked by an operator and cannot be told from a differently
 * planned burn. "180 of 300" is verifiable at a glance; "120 remaining" is not.
 */
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
      style={{ alignItems: "stretch", gap: "var(--space-8)" }}
    >
      {/* The chip alone. "delivered of planned" sat under it and only restated
          the two numbers already beside it, which is description rather than
          provenance: nothing was lost by cutting it. The claim it was making,
          that this reading is independent of who planned the burn, moved to the
          title on the figures themselves, where the numbers it describes are. */}
      <span style={{ ...PHASE_CHIP, color: phase.colour, minWidth: 0 }}>
        {phase.label}
      </span>
      <Stack
        gap="xs"
        style={{ alignItems: "flex-end", flex: "0 0 auto" }}
        title="Delivered delta-v against what the plan asked for. Independent of who planned the burn."
      >
        <Text tone="default" size="sm" style={{ whiteSpace: "nowrap" }}>
          {conformance.deliveredDv == null || conformance.plannedDv == null ? (
            NULL_DISPLAY
          ) : (
            <>
              <Unit
                value={value("m/s", conformance.deliveredDv)}
                decimals={1}
              />{" "}
              of{" "}
              <Unit value={value("m/s", conformance.plannedDv)} decimals={1} />
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
    </Row>
  );
}
