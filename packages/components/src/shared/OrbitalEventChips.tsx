import {
  useOrbitSolve,
  useOrbitSolveReading,
  useTelemetry,
} from "@ksp-gonogo/core";
import { isLocked, unlessLocked } from "@ksp-gonogo/sitrep-sdk";
import { Box, Cluster, Countdown, LockMark, Tooltip } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { countdownOf } from "./countdownOf";
import { encounterKindOf } from "./encounterKind";
import { useBodyName } from "./useBodyName";
import { useEncounterIn } from "./useEncounterIn";
import { useTrajectoryKind } from "./useTrajectoryKind";

/**
 * SOI encounter or escape, the next apsis, and a landed or suborbital chip
 * when the craft is not in orbit; nothing when none has data. The encounter comes from
 * the game's patched-conic solver, the apsis is solved from the elements, so an
 * encounter chip can stand alone. A periapsis below the surface is never
 * offered as the next apsis.
 */
export function OrbitalEventChips() {
  // Every chip is a claim about what happens next, so all withhold unless the orbit is current.
  const reading = useTelemetry("vessel.orbit");
  const orbit = reading.state === "observed" ? reading.value : undefined;
  const solve = useOrbitSolve();
  const solveReading = useOrbitSolveReading();
  const lockedEncounter = isLocked(orbit?.encounter) ? orbit.encounter : null;
  const encounter = unlessLocked(orbit?.encounter ?? null);

  const encounterKind = encounterKindOf(encounter);
  const encBody = useBodyName(encounter?.bodyIndex);
  const encIn = useEncounterIn();
  const hasEncounter =
    encounterKind !== null &&
    typeof encBody === "string" &&
    encBody.length > 0 &&
    encIn.value?.greaterThan(0) === true;

  const kind = useTrajectoryKind();
  const apsisType = orbit === undefined ? null : (solve?.nextApsisType ?? null);
  // The model's countdown is offered only while it counts to the same apsis.
  const timeToApsis =
    orbit === undefined
      ? undefined
      : countdownOf(solveReading, (s) =>
          s.nextApsisType === apsisType ? s.timeToNextApsis : null,
        );
  const hasApsis =
    kind !== "landed" &&
    (apsisType === 1 || (apsisType === -1 && kind !== "suborbital")) &&
    timeToApsis?.value?.isFinite() === true &&
    !timeToApsis.value.lessThan(0);
  const offOrbit = kind === "landed" || kind === "suborbital";

  if (!hasEncounter && !hasApsis && !offOrbit && lockedEncounter === null) {
    return null;
  }

  return (
    <Cluster justify="start" wrap>
      {offOrbit && (
        <Chip
          variant="neutral"
          tip={
            kind === "landed"
              ? "On the surface: the orbital elements describe a path through the body"
              : "Periapsis is below the surface: the craft will not complete an orbit"
          }
        >
          <ChipLabel>{kind === "landed" ? "LANDED" : "SUBORBITAL"}</ChipLabel>
        </Chip>
      )}
      {lockedEncounter !== null && (
        <Chip variant="neutral" tip="Sphere of influence encounter">
          <ChipLabel>ENC</ChipLabel>
          <ChipValue>
            <LockMark lock={lockedEncounter} />
          </ChipValue>
        </Chip>
      )}
      {hasEncounter && (
        <Chip
          variant={encounterKind === "escape" ? "warn" : "go"}
          tip={
            encounterKind === "escape"
              ? "Sphere of influence escape"
              : "Sphere of influence encounter"
          }
        >
          <ChipLabel>{encounterKind === "escape" ? "ESCAPE" : "ENC"}</ChipLabel>
          <ChipValue>
            {encBody as string} · <Countdown value={encIn} />
          </ChipValue>
        </Chip>
      )}
      {hasApsis && (
        <Chip
          variant="neutral"
          tip={apsisType === -1 ? "Next periapsis" : "Next apoapsis"}
        >
          <ChipLabel>NEXT</ChipLabel>
          <ChipValue>
            {apsisType === -1 ? "Pe" : "Ap"} · <Countdown value={timeToApsis} />
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
    border: "var(--color-go-status)",
    background: "var(--color-go-status)",
    color: "var(--color-go-on-status)",
  },
  warn: {
    border: "var(--color-warn-mark)",
    background: "var(--color-warn-status)",
    color: "var(--color-warn-on-status)",
  },
  neutral: {
    border: "var(--color-border-subtle)",
    background: "transparent",
    color: "var(--color-text-primary)",
  },
};

/** A compact bordered pill: label + value, tone-coloured per variant. */
function Chip({
  variant,
  tip,
  children,
}: {
  variant: ChipVariant;
  /** What the abbreviated label stands for. */
  tip: string;
  children: ReactNode;
}) {
  const tone = CHIP_TONE[variant];
  return (
    <Tooltip text={tip} focusable>
      <Box
        pad="chip-readout"
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
    </Tooltip>
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
