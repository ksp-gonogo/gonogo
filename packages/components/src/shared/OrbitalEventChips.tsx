import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { Box, Cluster, Countdown } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/**
 * Vessel-wide orbital event chips: an SOI encounter / escape and the next
 * apsis. Reads `o.encounterExists / encounterBody / encounterTime` and
 * `o.nextApsisType / timeToNextApsis`. Renders nothing when neither has data.
 *
 * `o.encounterExists` is the gate: -1 = escape (leaving current SOI),
 * 0 = none, 1 = encounter (entering another body's SOI). The body / time
 * fields only carry meaningful values when this is non-zero.
 *
 * `o.nextApsisType`: -1 = Pe, 1 = Ap, 0 = N/A (hyperbolic past Pe).
 */
export function OrbitalEventChips() {
  const vesselState = useStream<VesselState>("vessel.state");
  const enc = vesselState?.encounterExists;
  const encBody = vesselState?.encounterBody;
  const encTime = vesselState?.encounterTime;
  const apsisType = vesselState?.nextApsisType;
  const timeToApsis = vesselState?.timeToNextApsis;

  const encounterKind: "encounter" | "escape" | null =
    typeof enc === "number" && enc === 1
      ? "encounter"
      : typeof enc === "number" && enc === -1
        ? "escape"
        : null;
  const hasEncounter =
    encounterKind !== null &&
    typeof encBody === "string" &&
    encBody.length > 0 &&
    typeof encTime === "number" &&
    Number.isFinite(encTime) &&
    encTime > 0;

  const hasApsis =
    typeof apsisType === "number" &&
    apsisType !== 0 &&
    typeof timeToApsis === "number" &&
    Number.isFinite(timeToApsis) &&
    timeToApsis >= 0;

  if (!hasEncounter && !hasApsis) return null;

  return (
    <Cluster justify="start" wrap>
      {hasEncounter && (
        <Chip variant={encounterKind === "escape" ? "warn" : "go"}>
          <ChipLabel>{encounterKind === "escape" ? "ESCAPE" : "ENC"}</ChipLabel>
          <ChipValue>
            {encBody as string} · <Countdown value={encTime as number} />
          </ChipValue>
        </Chip>
      )}
      {hasApsis && (
        <Chip variant="neutral">
          <ChipLabel>NEXT</ChipLabel>
          <ChipValue>
            {apsisType === -1 ? "Pe" : "Ap"} ·{" "}
            <Countdown value={timeToApsis as number} />
          </ChipValue>
        </Chip>
      )}
    </Cluster>
  );
}

type ChipVariant = "go" | "warn" | "neutral";

const CHIP_TONE: Record<
  ChipVariant,
  { border: string; background: string; color: string }
> = {
  go: {
    border: "var(--color-status-go-bg)",
    background: "var(--color-status-go-bg)",
    color: "var(--color-status-go-fg)",
  },
  warn: {
    border: "var(--color-status-warning-bg)",
    background: "var(--color-status-warning-bg)",
    color: "var(--color-status-warning-fg)",
  },
  neutral: {
    border: "var(--color-surface-raised)",
    background: "transparent",
    color: "var(--color-text-primary)",
  },
};

/** A compact bordered pill: label + value, tone-coloured per variant. */
function Chip({
  variant,
  children,
}: {
  variant: ChipVariant;
  children: ReactNode;
}) {
  const tone = CHIP_TONE[variant];
  return (
    <Box
      pad={["xs", "md"]}
      radius="xs"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "var(--space-6)",
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        fontSize: "10px",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </Box>
  );
}

function ChipLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "9px",
        fontWeight: 700,
        letterSpacing: "0.12em",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function ChipValue({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}
