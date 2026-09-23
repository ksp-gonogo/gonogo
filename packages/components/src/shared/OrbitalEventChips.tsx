import {
  useStream,
  useTopicStatus,
  useViewUt,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Box, Cluster, Countdown } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/**
 * Vessel-wide orbital event chips: an SOI encounter / escape and the next
 * apsis. Reads `o.encounterExists / encounterBody / UTsoi` and
 * `o.nextApsisType / timeToNextApsis`. Renders nothing when neither has data.
 *
 * `o.encounterExists` is the gate: -1 = escape (leaving current SOI),
 * 0 = none, 1 = encounter (entering another body's SOI). The body / time
 * fields only carry meaningful values when this is non-zero.
 *
 * `o.nextApsisType`: -1 = Pe, 1 = Ap, 0 = N/A (hyperbolic past Pe).
 *
 * `encounterTime` is an ABSOLUTE UT (`vessel.orbit.encounter.transitionUt`,
 * carried through unchanged), so the countdown is the frame's view time
 * subtracted from it, never the field itself. Rendering it raw put a Mun
 * encounter twenty minutes away on screen as "46d 2h", and the old
 * `encounterTime > 0` gate held the chip up forever because every UT passes
 * it. `timeToNextApsis` beside it really is a remaining duration, hence the
 * two being treated differently three lines apart: `Units.Seconds` is the
 * same token on both and cannot tell them apart.
 */
export function OrbitalEventChips() {
  const vesselState = useStream<VesselState>("vessel.state");
  /*
   * Every chip below is a claim about what happens NEXT, so they all withhold
   * together when the channel that feeds them stops.
   *
   * `vessel.state` is derived and carries no `Reading`, so only the currency
   * its channel definition computes can tell a current chip from a held-over
   * one; without it they all draw as confidently as live ones. An encounter
   * chip is the sharpest case: "Mun in 20m" held over from a dropped link is
   * an instruction about a rendezvous that may already have happened.
   *
   * Read at the same frame as the value, so the pair cannot disagree about
   * which frame it describes.
   */
  const stateCurrent = useTopicStatus("vessel.state") === "live";
  const enc = stateCurrent ? vesselState?.encounterExists : undefined;
  const encBody = stateCurrent ? vesselState?.encounterBody : undefined;
  const encUt = stateCurrent ? vesselState?.encounterUt : undefined;
  const viewUt = useViewUt();
  const apsisType = stateCurrent ? vesselState?.nextApsisType : undefined;
  const timeToApsis = stateCurrent ? vesselState?.timeToNextApsis : undefined;

  const encounterKind: "encounter" | "escape" | null =
    typeof enc === "number" && enc === 1
      ? "encounter"
      : typeof enc === "number" && enc === -1
        ? "escape"
        : null;
  const encIn =
    typeof encUt === "number" && Number.isFinite(encUt) && viewUt !== undefined
      ? value("ut", encUt).minus(viewUt).magnitude
      : undefined;
  const hasEncounter =
    encounterKind !== null &&
    typeof encBody === "string" &&
    encBody.length > 0 &&
    encIn !== undefined &&
    encIn > 0;

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
            {encBody as string} · <Countdown value={encIn as number} />
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
      radius="regular"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "var(--gap-related)",
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
