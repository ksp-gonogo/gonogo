import { useOrbitSolve, useTelemetry } from "@ksp-gonogo/core";
import {
  CELESTIAL_FACTS,
  useProcessor,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { TransitionType } from "@ksp-gonogo/sitrep-sdk";
import { Box, Cluster, Countdown } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/**
 * Vessel-wide orbital event chips: an SOI encounter / escape and the next
 * apsis. Renders nothing when neither has data.
 *
 * Both come off `vessel.orbit`, by two different routes. The encounter is a
 * field of the sample, carried from the game's own patched-conic solver and
 * read as it arrives. The next apsis is SOLVED from the elements at the view
 * instant, so it is absent wherever a conic through them would be wrong, which
 * is why an encounter chip can stand alone with no apsis chip beside it.
 *
 * `transitionUt` is an ABSOLUTE UT, so the countdown is the frame's view time
 * subtracted from it, never the field itself. Rendering it raw put a Mun
 * encounter twenty minutes away on screen as "46d 2h", and the old
 * `encounterTime > 0` gate held the chip up forever because every UT passes
 * it. `timeToNextApsis` beside it really is a remaining duration, hence the
 * two being treated differently three lines apart: `Units.Seconds` is the
 * same token on both and cannot tell them apart.
 */
export function OrbitalEventChips() {
  /*
   * Every chip below is a claim about what happens NEXT, so they all withhold
   * together when the elements behind them stop arriving. An encounter chip is
   * the sharpest case: "Mun in 20m" held over from a dropped link is an
   * instruction about a rendezvous that may already have happened.
   *
   * The solve reads this same topic at this same frame, so the two halves
   * cannot disagree about which frame they describe.
   */
  const reading = useTelemetry("vessel.orbit");
  const orbit = reading.state === "observed" ? reading.value : undefined;
  const solve = useOrbitSolve();
  const viewUt = useViewUt();
  const facts = useProcessor(CELESTIAL_FACTS);
  const encounter = orbit?.encounter ?? null;

  const encounterKind: "encounter" | "escape" | null =
    encounter?.transitionType === TransitionType.Encounter
      ? "encounter"
      : encounter?.transitionType === TransitionType.Escape
        ? "escape"
        : null;
  /* The index is how every other Topic names a body, so the name comes from
     the catalogue that owns that lookup rather than from a second table. */
  const encBody =
    encounter?.bodyIndex == null
      ? undefined
      : facts?.nameByIndex[encounter.bodyIndex];
  const encIn =
    encounter?.transitionUt.isFinite() === true && viewUt !== undefined
      ? encounter.transitionUt.minus(viewUt).magnitude
      : undefined;
  const hasEncounter =
    encounterKind !== null &&
    typeof encBody === "string" &&
    encBody.length > 0 &&
    encIn !== undefined &&
    encIn > 0;

  const apsisType = orbit === undefined ? null : (solve?.nextApsisType ?? null);
  const timeToApsis =
    orbit === undefined ? null : (solve?.timeToNextApsis ?? null);
  const hasApsis =
    (apsisType === 1 || apsisType === -1) &&
    timeToApsis !== null &&
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
      radius="xs"
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
