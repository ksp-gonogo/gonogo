import type { ComponentProps } from "@ksp-gonogo/core";
import { useActionInput } from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { canBeSacked, stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  NULL_DISPLAY,
  Panel,
  Section,
  Stat,
  StatContributions,
  StatStrip,
  speakQuantity,
  Tabs,
  Unit,
  useSlotBound,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { ActivePanel } from "./ActivePanel";
import { ApplicantsPanel } from "./ApplicantsPanel";
import type { AstronautComplexActions, AstronautComplexConfig } from "./config";
import { readApplicants, readCrewRoster } from "./roster";
import {
  ASTRONAUT_COMPLEX_READOUTS_SLOT,
  ASTRONAUT_COMPLEX_TRAINING_SLOT,
} from "./slots";
import { EMPTY_STYLE } from "./styles";
import { TrainingTab } from "./TrainingTab";
import { astronautComplexTopics } from "./topics";

/** KSP's `int.MaxValue`, which `GameVariables.GetActiveCrewLimit` returns for an unlimited roster; every tiered cap sits far below it. */
const UNLIMITED_CREW_CAP = 2_147_483_647;

/** A held balance's title: hiring stays available, since the game arbitrates the purchase. */
const HELD_FUNDS_TITLE = "Affordability is not judged against a held balance";

/** The balance's title: its figure in words while current, and why it is not judged while held. */
function fundsTitle(
  held: boolean,
  careerFunds: number | null,
): string | undefined {
  if (held) return HELD_FUNDS_TITLE;
  if (careerFunds === null) return undefined;
  return speakQuantity(value("funds", careerFunds), { decimals: 0 });
}

/** The roster cap as written: unlimited, a figure, or nothing known. */
function capTextOf(
  crewCapacity: number | null,
  capUnlimited: boolean,
  capKnown: boolean,
): string | null {
  if (capUnlimited) return "Unlimited";
  if (capKnown) return String(crewCapacity);
  return null;
}

export function AstronautComplexComponent(
  _props: Readonly<ComponentProps<AstronautComplexConfig>>,
) {
  /**
   * Every field on the complex record is a fact that only an event moves, so
   * the record takes `stillTrue` whole: a blanked pool would report no
   * candidates for a save that has four waiting.
   */
  const complexReading = astronautComplexTopics.useTelemetry(
    "spaceCenter.astronautComplex",
  );
  const complex = stillTrue(complexReading, undefined);
  // `absent` is off career; `pending` is a cold start and gets its own sentence.
  const complexConfirmedEmpty = complexReading.state === "absent";
  /**
   * Funds is the one judgement here: it sits beside a spend control and decides
   * `affordable`, so a held balance is withheld from the verdict. It stays on
   * screen as the whole field reading, marked by its Unit.
   */
  const fundsReading = astronautComplexTopics.useTelemetry("career.status");
  const careerFunds = magnitudeOf(
    fundsReading.state === "observed"
      ? fundsReading.value.balances?.funds
      : undefined,
  );
  const hasFunds = stillTrue(fundsReading, undefined)?.balances?.funds != null;
  // A kerbal is on the books until an event takes them off, so the last roster received stands.
  const crewRosterRaw = stillTrue(
    astronautComplexTopics.useTelemetry("spaceCenter.crewRoster"),
    undefined,
  );
  const crewRoster = useMemo(
    () => readCrewRoster(crewRosterRaw),
    [crewRosterRaw],
  );
  // The training tab exists only while something claims its slot.
  const trainingBound = useSlotBound(ASTRONAUT_COMPLEX_TRAINING_SLOT);

  // A KSC ground action, dispatched at the meta-vantage; the handle still has to reach the delay rail.
  const hireCmd = useCommand("career.crew.hire", { vantage: META_VANTAGE });

  // Firing is the same kind of KSC ground action: instant and free.
  const fireCmd = useCommand("career.crew.fire", { vantage: META_VANTAGE });

  const sackableCrew = useMemo(
    () => crewRoster.filter((c) => !c.isApplicant && canBeSacked(c.standing)),
    [crewRoster],
  );
  const [highlightedName, setHighlightedName] = useState<string | null>(null);
  const [armedName, setArmedName] = useState<string | null>(null);
  // By name, so the highlight follows its kerbal through a reorder and falls to the first fireable one when it leaves.
  const highlighted =
    sackableCrew.find((c) => c.name === highlightedName) ?? sackableCrew[0];

  useActionInput<AstronautComplexActions>({
    highlightNextAvailable: (payload) => {
      // Fire on the press edge only, so one tap steps one row.
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (sackableCrew.length === 0 || !highlighted) return undefined;
      const next =
        sackableCrew[
          (sackableCrew.indexOf(highlighted) + 1) % sackableCrew.length
        ];
      setHighlightedName(next.name);
      setArmedName(null);
      return { highlighted: next.name };
    },
    fireHighlighted: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (!highlighted) return undefined;
      if (armedName !== highlighted.name) {
        setArmedName(highlighted.name);
        return { armed: highlighted.name };
      }
      setArmedName(null);
      void fireCmd.send({ kerbalName: highlighted.name });
      return { fired: highlighted.name };
    },
  });

  const applicants = readApplicants(complex?.applicants);
  const activeCrew = magnitudeOf(complex?.activeCrew);
  const crewCapacity = magnitudeOf(complex?.crewCapacity);
  // The recruit price rises with roster size, not per applicant, so it is one header readout.
  const nextHireCost = magnitudeOf(complex?.nextHireCost);

  const capUnlimited =
    crewCapacity !== null && crewCapacity >= UNLIMITED_CREW_CAP;
  const capKnown = crewCapacity !== null && crewCapacity > 0;
  const rosterFull =
    capKnown &&
    !capUnlimited &&
    activeCrew !== null &&
    activeCrew >= (crewCapacity as number);

  const affordable =
    nextHireCost !== null &&
    (careerFunds === null || careerFunds >= nextHireCost);

  const fundsStat = (
    <Stat label="Funds">
      {hasFunds ? (
        <span title={fundsTitle(fundsReading.state === "held", careerFunds)}>
          <Unit value={fundsReading.balances.funds} />
        </span>
      ) : (
        NULL_DISPLAY
      )}
    </Stat>
  );

  // Off career or before telemetry: no applicant pool, still surfacing funds when known.
  if (complex === undefined) {
    return (
      <Panel
        panelTitle="ASTRONAUT COMPLEX"
        compactTitle={["ASTRONAUTS", "CREW"]}
        sections={
          <Section full gap="section-compact">
            <StatStrip role="status" aria-live="polite">
              {fundsStat}
              <StatContributions slot={ASTRONAUT_COMPLEX_READOUTS_SLOT} />
            </StatStrip>
            <div style={EMPTY_STYLE}>
              {complexConfirmedEmpty
                ? "No applicant data (career mode only)"
                : "No applicant data yet (waiting for telemetry)"}
            </div>
          </Section>
        }
      />
    );
  }

  const capText = capTextOf(crewCapacity, capUnlimited, capKnown);

  return (
    <Panel
      panelTitle="ASTRONAUT COMPLEX"
      compactTitle={["ASTRONAUTS", "CREW"]}
      sections={[
        /* Both span: a tab strip beside anything reads as two widgets. */
        <Section key="stats" full>
          <StatStrip role="status" aria-live="polite">
            {fundsStat}
            <Stat
              label="Next Hire"
              tone={nextHireCost === null || affordable ? "neutral" : "nogo"}
            >
              {nextHireCost !== null ? (
                <span
                  title={speakQuantity(value("funds", nextHireCost), {
                    decimals: 0,
                  })}
                >
                  <Unit value={complexReading.nextHireCost} />
                </span>
              ) : (
                NULL_DISPLAY
              )}
            </Stat>
            <Stat label="Active Kerbals" tone={rosterFull ? "nogo" : "neutral"}>
              {activeCrew !== null ? activeCrew : NULL_DISPLAY}
              {capText !== null ? ` / ${capText}` : ""}
              {rosterFull && (
                <Badge tone="nogo" size="sm">
                  FULL
                </Badge>
              )}
            </Stat>
            {/* Whatever the save's career model considers as core as the three above. */}
            <StatContributions slot={ASTRONAUT_COMPLEX_READOUTS_SLOT} />
          </StatStrip>
        </Section>,
        <Section key="roster" full>
          <Tabs
            tabs={[
              {
                id: "applicants",
                label: "Applicants",
                content: (
                  <ApplicantsPanel
                    applicants={applicants}
                    hireCost={nextHireCost}
                    hireCmd={hireCmd}
                  />
                ),
              },
              {
                id: "active",
                label: "Active",
                content: (
                  <ActivePanel
                    crew={crewRoster}
                    fireCmd={fireCmd}
                    highlightedName={highlighted?.name ?? null}
                    armed={
                      armedName !== null && armedName === highlighted?.name
                    }
                  />
                ),
              },
              ...(trainingBound
                ? [
                    {
                      id: "training",
                      label: "Training",
                      content: <TrainingTab />,
                    },
                  ]
                : []),
            ]}
          />
        </Section>,
      ]}
    />
  );
}
