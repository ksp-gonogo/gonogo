import {
  useOrbitSolve,
  useOrbitSolveReading,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { deriveReading } from "@ksp-gonogo/sitrep-sdk";
import { Box, Cluster, Countdown } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { encounterKindOf } from "./encounterKind";
import { solveCountdown } from "./solveCountdown";
import { useBodyName } from "./useBodyName";

/**
 * SOI encounter or escape, and the next apsis; nothing when neither has data.
 * The encounter comes from the game's patched-conic solver, the apsis is
 * solved from the elements, so an encounter chip can stand alone.
 */
export function OrbitalEventChips() {
  // Every chip is a claim about what happens next, so all withhold unless the orbit is current.
  const reading = useTelemetry("vessel.orbit");
  const orbit = reading.state === "observed" ? reading.value : undefined;
  const solve = useOrbitSolve();
  const solveReading = useOrbitSolveReading();
  const receivedUt = useViewUt();
  const encounter = orbit?.encounter ?? null;

  const encounterKind = encounterKindOf(encounter);
  const encBody = useBodyName(encounter?.bodyIndex);
  // `transitionUt` is an absolute UT, unlike `timeToNextApsis`, though both carry "s".
  const encIn = deriveReading(
    reading,
    (o) =>
      o.encounter?.transitionUt.isFinite() === true && receivedUt !== undefined
        ? o.encounter.transitionUt.minus(receivedUt)
        : undefined,
    (o, atUt) =>
      o.encounter?.transitionUt.isFinite() === true
        ? o.encounter.transitionUt.minus(atUt)
        : undefined,
  );
  const hasEncounter =
    encounterKind !== null &&
    typeof encBody === "string" &&
    encBody.length > 0 &&
    encIn.value?.greaterThan(0) === true;

  const apsisType = orbit === undefined ? null : (solve?.nextApsisType ?? null);
  // The model's countdown is offered only while it counts to the same apsis.
  const timeToApsis =
    orbit === undefined
      ? undefined
      : solveCountdown(solveReading, (s) =>
          s.nextApsisType === apsisType ? s.timeToNextApsis : null,
        );
  const hasApsis =
    (apsisType === 1 || apsisType === -1) &&
    timeToApsis?.value?.isFinite() === true &&
    !timeToApsis.value.lessThan(0);

  if (!hasEncounter && !hasApsis) return null;

  return (
    <Cluster justify="start" wrap>
      {hasEncounter && (
        <Chip variant={encounterKind === "escape" ? "warn" : "go"}>
          <ChipLabel>{encounterKind === "escape" ? "ESCAPE" : "ENC"}</ChipLabel>
          <ChipValue>
            {encBody as string} · <Countdown value={encIn} />
          </ChipValue>
        </Chip>
      )}
      {hasApsis && (
        <Chip variant="neutral">
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
    border: "var(--color-border-subtle)",
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
