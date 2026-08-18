import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  ActionButton,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  ScrollArea,
  speakQuantity,
  type TabDescriptor,
  Tabs,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { judgeable, notCurrent, stillTrue } from "../shared/currency";
import { type KerbalStatFields, KerbalStats } from "../shared/KerbalStats";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";

type AstronautComplexConfig = Record<string, never>;

/**
 * KSP's `int.MaxValue`, the literal sentinel `GameVariables.GetActiveCrewLimit`
 * returns at the top Astronaut Complex tier (an unlimited roster). The mod
 * preserves it verbatim on the wire, so a `>= int.MaxValue` floor guard is the
 * correct test: every real save's tiered cap sits far below it (tier 1 caps
 * at 5, tier 2 at 13), so there is no risk of a legitimate cap reading as
 * unlimited.
 */
const UNLIMITED_CREW_CAP = 2_147_483_647;

const ARM_TIMEOUT_MS = 4000;

/**
 * Said on screen whenever the balance is withheld for going stale, so the blank
 * beside "Funds" is legible as a refusal to quote rather than as a balance
 * nobody has sent yet. Hiring stays available: the game arbitrates the purchase,
 * and refusing locally on a balance we cannot see would block a legal hire.
 */
const FUNDS_STALE_NOTE = "Funds no longer current";

/**
 * Firing is a per-row action against an arbitrary-length Available list, the
 * same "cycle then act" shape {@link PowerSystems}'s `cycleResource` and
 * {@link ResourceOps}'s `next` use for a physical control with no way to pick
 * an arbitrary row: `highlightNextAvailable` walks a highlighted index over
 * the Available crew, `fireHighlighted` fires whoever it currently points at.
 * The mouse/touch path (the per-row {@link FireButton}) doesn't go through
 * this highlight at all, it always targets its own row directly.
 */
const astronautComplexActions = [
  {
    id: "highlightNextAvailable",
    label: "Next available crew",
    accepts: ["button"],
    description:
      "Cycles the highlighted Available crew member, the target fireHighlighted acts on.",
  },
  {
    id: "fireHighlighted",
    label: "Fire highlighted crew",
    accepts: ["button"],
    description:
      "Fires the currently highlighted Available crew member back to the applicant pool. No cost, reversible.",
  },
] as const satisfies readonly ActionDefinition[];

type AstronautComplexActions = typeof astronautComplexActions;

interface Applicant {
  name: string;
  trait: string;
  experienceLevel: number;
  courage: number | null;
  stupidity: number | null;
  roleDescription: string;
  descriptionEffects: string;
}

/** An applicant carries only the fields the pool shows. The remaining
 *  astronaut stats the shared row can render (veteran, badass, career
 *  flights, current assignment) do not apply to someone not yet on the
 *  books, so they take their safe zero and those badges never render. Rank
 *  is retained on the model (astronauts keep experience when dismissed and
 *  rehired) but withheld from display via `showRank={false}`. */
function applicantStats(a: Applicant): KerbalStatFields {
  return {
    name: a.name,
    trait: a.trait,
    experienceLevel: a.experienceLevel,
    veteran: false,
    isBadass: false,
    careerFlights: 0,
    available: true,
    unavailableReason: "",
    // The unavailable badge never renders while available is true, so this
    // never feeds the severity derivation; kept as the applicant pool's
    // implicit standing rather than left undefined.
    situation: "Applicant",
    currentVesselName: "",
    courage: a.courage,
    stupidity: a.stupidity,
    roleDescription: a.roleDescription,
    descriptionEffects: a.descriptionEffects,
  };
}

function AstronautComplexComponent(
  _props: Readonly<ComponentProps<AstronautComplexConfig>>,
) {
  /**
   * The applicant pool, roster cap and active-crew count ride the
   * spaceCenter.astronautComplex Topic; funds comes off
   * career.status.economy.funds (the same read SpaceCenterStatus uses). Both
   * degrade to nothing outside career, so the widget shows an empty state
   * rather than erroring.
   *
   * All four fields on the complex record are facts, which is why the record
   * takes `stillTrue` whole: the applicant pool changes when the game refreshes
   * it or somebody is hired, the active-crew count when somebody is hired or
   * fired, the cap when the facility is upgraded, and the next-hire price is a
   * quote the game derives from the roster size. None of them can move while
   * nobody is looking, and a blanked pool would report a Complex with no
   * candidates for a save that has four waiting.
   */
  const complexReading = useTelemetry("spaceCenter.astronautComplex");
  const complex = stillTrue(complexReading, undefined);
  /**
   * Off career there is no Astronaut Complex and the producer says so, which is
   * `absent` and is the case the "career mode only" wording was written for.
   * `pending` is a cold start, and it gets its own sentence so a first paint
   * stops reading as a save with no space programme.
   */
  const complexConfirmedEmpty = complexReading.state === "absent";
  /**
   * Funds is the one judgement in this widget. The figure sits beside a spend
   * control, the operator reads it as the balance they are about to spend from,
   * and it decides `affordable`. A recovery or a purchase moves it while the
   * link is down, so a held balance is a claim about money that may already be
   * spent; withheld instead, with `fundsNotCurrent` saying which of the two
   * reasons the figure is missing for.
   */
  const fundsReading = useTelemetry("career.status");
  const careerFunds = magnitudeOf(judgeable(fundsReading)?.economy?.funds);
  const fundsNotCurrent = notCurrent(fundsReading);
  /**
   * The hired-crew roster is the textbook fact: a kerbal is on the books until
   * an event takes them off, so the last roster received is still the roster.
   */
  const crewRosterRaw = stillTrue(
    useTelemetry("spaceCenter.crewRoster"),
    undefined,
  );
  const crewRoster = useMemo(
    () => readCrewRoster(crewRosterRaw),
    [crewRosterRaw],
  );

  // Hiring is a KSC ground action (no vessel signal delay), so it dispatches at
  // the meta-vantage (instant). usePanelDelay contributes the handle to the
  // panel's delay rail (a no-op here, but the must-consume invariant requires it).
  const hireCmd = useCommand("career.crew.hire", { vantage: META_VANTAGE });
  usePanelDelay(hireCmd);

  // Firing is the same kind of KSC ground action as hiring: instant, no
  // signal delay, no cost.
  const fireCmd = useCommand("career.crew.fire", { vantage: META_VANTAGE });
  usePanelDelay(fireCmd);

  const availableCrew = useMemo(
    () => crewRoster.filter((c) => c.situation === "Available"),
    [crewRoster],
  );
  const [highlightedFireIndex, setHighlightedFireIndex] = useState(0);

  useActionInput<AstronautComplexActions>({
    highlightNextAvailable: (payload) => {
      // Fire on the press edge only, so one tap steps one row.
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (availableCrew.length === 0) return undefined;
      const next = (highlightedFireIndex + 1) % availableCrew.length;
      setHighlightedFireIndex(next);
      return { highlighted: availableCrew[next]?.name ?? "" };
    },
    fireHighlighted: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (availableCrew.length === 0) return undefined;
      const target = availableCrew[highlightedFireIndex % availableCrew.length];
      if (!target) return undefined;
      void fireCmd.send({ kerbalName: target.name });
      return { fired: target.name };
    },
  });

  const applicants = readApplicants(complex?.applicants);
  const activeCrew = magnitudeOf(complex?.activeCrew);
  const crewCapacity = magnitudeOf(complex?.crewCapacity);
  // One hire cost for the whole pool (spaceCenter.astronautComplex.nextHireCost):
  // the recruit price rises with roster size, not per applicant, so it is a
  // single header readout rather than a figure repeated on every row.
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
  const canHire = affordable && !rosterFull;

  // Off career (or before telemetry warms up): no applicant pool at all. Show a
  // graceful empty state, still surfacing funds when they are known.
  if (complex === undefined) {
    return (
      <Panel panelTitle="ASTRONAUT COMPLEX">
        <Body>
          <FundsLine role="status">
            <FundsLabel>Funds</FundsLabel>
            {careerFunds !== null ? (
              <FundsValue title="Available funds">
                <Unit value={value("funds", careerFunds)} />
              </FundsValue>
            ) : (
              <FundsValue>{NULL_DISPLAY}</FundsValue>
            )}
          </FundsLine>
          {fundsNotCurrent && (
            <ReadoutCaption>{FUNDS_STALE_NOTE}</ReadoutCaption>
          )}
          <Empty>
            {complexConfirmedEmpty
              ? "No applicant data (career mode only)"
              : "No applicant data yet (waiting for telemetry)"}
          </Empty>
        </Body>
      </Panel>
    );
  }

  const capText = capUnlimited
    ? "Unlimited"
    : capKnown
      ? String(crewCapacity)
      : null;

  return (
    <Panel panelTitle="ASTRONAUT COMPLEX">
      <Body>
        <Header role="status" aria-live="polite">
          <StatBox>
            <StatLabel>Funds</StatLabel>
            {careerFunds !== null ? (
              <StatValue
                title={speakQuantity(value("funds", careerFunds), {
                  decimals: 0,
                })}
              >
                <Unit value={value("funds", careerFunds)} />
              </StatValue>
            ) : (
              <StatValue>{NULL_DISPLAY}</StatValue>
            )}
            {fundsNotCurrent && (
              <ReadoutCaption>{FUNDS_STALE_NOTE}</ReadoutCaption>
            )}
          </StatBox>
          <StatBox>
            <StatLabel>Next Hire</StatLabel>
            {nextHireCost !== null ? (
              <StatValue
                $critical={!affordable}
                title={speakQuantity(value("funds", nextHireCost), {
                  decimals: 0,
                })}
              >
                <Unit value={value("funds", nextHireCost)} />
              </StatValue>
            ) : (
              <StatValue>{NULL_DISPLAY}</StatValue>
            )}
          </StatBox>
          <StatBox>
            <StatLabel>Active Kerbals</StatLabel>
            <StatValue $critical={rosterFull}>
              {activeCrew !== null ? activeCrew : NULL_DISPLAY}
              {capText !== null ? ` / ${capText}` : ""}
              {rosterFull && <FullBadge>FULL</FullBadge>}
            </StatValue>
          </StatBox>
        </Header>

        <Tabs
          tabs={[
            {
              id: "applicants",
              label: "Applicants",
              content: (
                <ApplicantsPanel
                  applicants={applicants}
                  affordable={affordable}
                  canHire={canHire}
                  rosterFull={rosterFull}
                  hireCost={nextHireCost}
                  onHire={(applicantName) =>
                    void hireCmd.send({ applicantName })
                  }
                />
              ),
            },
            {
              id: "active",
              label: "Active",
              content: (
                <ActivePanel
                  crew={crewRoster}
                  onFire={(kerbalName) => void fireCmd.send({ kerbalName })}
                  highlightedFireIndex={highlightedFireIndex}
                />
              ),
            },
          ]}
        />
      </Body>
    </Panel>
  );
}

function ApplicantsPanel({
  applicants,
  affordable,
  canHire,
  rosterFull,
  hireCost,
  onHire,
}: {
  applicants: Applicant[];
  affordable: boolean;
  canHire: boolean;
  rosterFull: boolean;
  hireCost: number | null;
  onHire: (applicantName: string) => void;
}) {
  if (applicants.length === 0) {
    return <Empty>No applicants right now</Empty>;
  }
  return (
    <List>
      {applicants.map((a) => (
        // Kerbal names are unique within the applicant pool, so the name is
        // a stable key (no array index).
        <Applicant__Row key={a.name}>
          <Who>
            <KerbalStats
              kerbal={applicantStats(a)}
              showRank={false}
              showTraits
              showInfo
            />
          </Who>
          <HireButton
            applicantName={a.name}
            hireCost={hireCost}
            enabled={canHire}
            disabledReason={
              rosterFull
                ? "Roster full"
                : !affordable
                  ? "Insufficient funds"
                  : undefined
            }
            onConfirm={() => onHire(a.name)}
          />
        </Applicant__Row>
      ))}
    </List>
  );
}

/**
 * The Active tab: itself tabbed, one sub-tab per distinct `situation` string
 * actually present on the hired-crew roster (Available/Assigned/Dead/Missing,
 * and any mod value for free, e.g. RO/RP-1 "Retired"). A situation with zero
 * members simply has no bucket, so it never produces an empty tab.
 *
 * Composition: ONE underlying `crew` array, sliced per situation for each
 * tab's content, rather than a `FilterBar` toggle group layered over a single
 * flat list. The shared `Tabs` primitive already IS the mutually-exclusive
 * filter switch here, so the situations read as tabs, matching the top-level
 * Applicants|Active split one level up rather than introducing a second
 * filtering idiom for the same shape of decision.
 */
function ActivePanel({
  crew,
  onFire,
  highlightedFireIndex,
}: {
  crew: CrewRosterRow[];
  onFire: (kerbalName: string) => void;
  highlightedFireIndex: number;
}) {
  // Defensive, not load-bearing: spaceCenter.crewRoster never actually
  // carries situation "Applicant" (that value only appears in the
  // astronautComplex applicant pool), but filtering it out here keeps this
  // panel correct even if a future producer ever merges the two channels.
  const active = crew.filter((c) => c.situation !== "Applicant");
  if (active.length === 0) {
    return <Empty>No active crew</Empty>;
  }

  const groups = groupBySituation(active);
  const situations = orderSituations(groups.keys());
  const tabs: TabDescriptor[] = situations.map((situation) => {
    const members = groups.get(situation) ?? [];
    const keys = crewRowKeys(members);
    // KerbalRoster.SackAvailable only ever accepts an Available crew member
    // (see FireCrew's mod-side doc comment), so the Fire control renders on
    // this situation's rows alone; Assigned/Dead/Missing never get one.
    const fireable = situation === "Available";
    return {
      // The tab set is built dynamically from whatever situations are
      // present, so each id is the raw situation string itself, never the
      // array-index fallback: an index can collide across re-renders once
      // the set of present situations changes, a stable id can't.
      id: situation,
      label: `${situation} (${members.length})`,
      content: (
        <List>
          {members.map((m, i) => (
            <Applicant__Row
              key={keys[i]}
              aria-current={
                fireable && i === highlightedFireIndex % members.length
                  ? "true"
                  : undefined
              }
            >
              <Who>
                <KerbalStats
                  kerbal={crewRowStats(m)}
                  showRank
                  showTraits
                  showExperienceProgress
                  showInfo
                />
              </Who>
              {fireable && (
                <FireButton
                  kerbalName={m.name}
                  onConfirm={() => onFire(m.name)}
                />
              )}
            </Applicant__Row>
          ))}
        </List>
      ),
    };
  });

  return <Tabs tabs={tabs} />;
}

/**
 * Arm-then-confirm hire button (a funds SPEND, so it never fires on a single
 * click): first click arms a go-toned "Confirm" that auto-disarms after
 * {@link ARM_TIMEOUT_MS}. Reuses the ui-kit {@link ActionButton} primitive
 * (`ghost` -> `go`), the same spend-confirm pattern SpaceCenterStatus uses for
 * facility upgrades.
 */
function HireButton({
  applicantName,
  hireCost,
  enabled,
  disabledReason,
  onConfirm,
}: {
  applicantName: string;
  hireCost: number | null;
  enabled: boolean;
  disabledReason?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // The cost moved to the header (one figure for the whole pool), so a
  // screen-reader user tabbing straight to the button still needs to hear
  // what hiring costs; speakQuantity (word form) rather than <Unit> because
  // this only ever renders as an accessible name, never on screen.
  const costText =
    hireCost !== null
      ? ` for ${speakQuantity(value("funds", hireCost), { decimals: 0 })}`
      : "";

  if (!enabled) {
    return (
      <ActionButton
        type="button"
        disabled
        title={disabledReason}
        aria-label={`Hire ${applicantName || "applicant"}${costText} (${disabledReason ?? "unavailable"})`}
      >
        Hire
      </ActionButton>
    );
  }
  if (!armed) {
    return (
      <ActionButton
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`Hire ${applicantName || "applicant"}${costText}`}
      >
        Hire
      </ActionButton>
    );
  }
  return (
    <ActionButton
      type="button"
      tone="go"
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
      aria-label={`Confirm hire of ${applicantName || "applicant"}${costText}`}
    >
      Confirm
    </ActionButton>
  );
}

/**
 * Arm-then-confirm fire button, the inverse of {@link HireButton}: no cost
 * (so no header readout to speak in the accessible name) but the same
 * two-step click pattern, a fire is destructive enough to warrant it even
 * though it's reversible (a re-hire brings the kerbal back with their stats
 * intact). Always enabled, it only ever renders on an Available row, the
 * one roster standing `career.crew.fire` accepts.
 */
function FireButton({
  kerbalName,
  onConfirm,
}: {
  kerbalName: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <ActionButton
        type="button"
        onClick={() => setArmed(true)}
        aria-label={`Fire ${kerbalName || "crew member"}`}
      >
        Fire
      </ActionButton>
    );
  }
  return (
    <ActionButton
      type="button"
      tone="go"
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
      aria-label={`Confirm fire of ${kerbalName || "crew member"}`}
    >
      Confirm
    </ActionButton>
  );
}

/** One row from `spaceCenter.crewRoster`: the hired-crew roster, shared wire
 *  shape with {@link Applicant} but carrying `situation` (the raw roster
 *  standing the Active tab groups by) and `experienceLevelDelta` (progress
 *  toward the next rank). */
interface CrewRosterRow {
  name: string;
  trait: string;
  experienceLevel: number;
  situation: string;
  available: boolean;
  unavailableReason: string;
  courage: number | null;
  stupidity: number | null;
  experienceLevelDelta: number | null;
  roleDescription: string;
  descriptionEffects: string;
}

/** A hired kerbal's veteran/badass/career-flight badges don't exist on the
 *  wire (`CrewRosterEntry` carries only what the Astronaut Complex shows),
 *  so they take their safe zero here the same way {@link applicantStats}
 *  does for an applicant's rank fields. */
function crewRowStats(c: CrewRosterRow): KerbalStatFields {
  return {
    name: c.name,
    trait: c.trait,
    experienceLevel: c.experienceLevel,
    veteran: false,
    isBadass: false,
    careerFlights: 0,
    available: c.available,
    unavailableReason: c.unavailableReason,
    situation: c.situation,
    currentVesselName: "",
    courage: c.courage,
    stupidity: c.stupidity,
    experienceLevelDelta: c.experienceLevelDelta,
    roleDescription: c.roleDescription,
    descriptionEffects: c.descriptionEffects,
  };
}

// Dead/Missing/Available/Assigned is the situation set the fetchability audit
// confirmed `RosterStatus` actually emits; any other value (e.g. a mod's RO/
// RP-1 "Retired") is a situation this list has never heard of, so it sorts
// after the known ones, alphabetically, rather than being dropped.
const KNOWN_SITUATION_ORDER = ["Available", "Assigned", "Dead", "Missing"];

function orderSituations(situations: Iterable<string>): string[] {
  const present = new Set(situations);
  const known = KNOWN_SITUATION_ORDER.filter((s) => present.has(s));
  const unknown = [...present]
    .filter((s) => !KNOWN_SITUATION_ORDER.includes(s))
    .sort();
  return [...known, ...unknown];
}

/** Groups active crew by their raw `situation` string, one bucket per
 *  distinct value actually present. No hardcoded tab list: a mod introducing
 *  a new situation gets a bucket for free, and a known situation with zero
 *  members simply produces no bucket (so it never renders an empty tab). */
function groupBySituation(
  crew: readonly CrewRosterRow[],
): Map<string, CrewRosterRow[]> {
  const groups = new Map<string, CrewRosterRow[]>();
  for (const row of crew) {
    const bucket = groups.get(row.situation);
    if (bucket) bucket.push(row);
    else groups.set(row.situation, [row]);
  }
  return groups;
}

/** Stable per-row keys for a situation's member list. Kerbal names aren't
 *  guaranteed unique within a situation (a re-hired duplicate is legal), so
 *  each key is name + an occurrence count rather than the array index. */
function crewRowKeys(members: readonly CrewRosterRow[]): string[] {
  const seen = new Map<string, number>();
  return members.map((m) => {
    const n = seen.get(m.name) ?? 0;
    seen.set(m.name, n + 1);
    return `${m.name}#${n}`;
  });
}

function readCrewRoster(raw: unknown): CrewRosterRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CrewRosterRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      name: typeof e.name === "string" ? e.name : "",
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOf(e.experienceLevel as Quantityish) ?? 0,
      situation: typeof e.situation === "string" ? e.situation : "",
      available: e.available === true,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
      courage: magnitudeOf(e.courage as Quantityish),
      stupidity: magnitudeOf(e.stupidity as Quantityish),
      experienceLevelDelta: magnitudeOf(e.experienceLevelDelta as Quantityish),
      roleDescription:
        typeof e.roleDescription === "string" ? e.roleDescription : "",
      descriptionEffects:
        typeof e.descriptionEffects === "string" ? e.descriptionEffects : "",
    });
  }
  return out;
}

function readApplicants(raw: unknown): Applicant[] {
  if (!Array.isArray(raw)) return [];
  const out: Applicant[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      name: typeof e.name === "string" ? e.name : "",
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOf(e.experienceLevel as Quantityish) ?? 0,
      courage: magnitudeOf(e.courage as Quantityish),
      stupidity: magnitudeOf(e.stupidity as Quantityish),
      roleDescription:
        typeof e.roleDescription === "string" ? e.roleDescription : "",
      descriptionEffects:
        typeof e.descriptionEffects === "string" ? e.descriptionEffects : "",
    });
  }
  return out;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
  }
`;

const Header = styled.div`
  display: flex;
  align-items: stretch;
  gap: var(--space-12);
  flex-wrap: wrap;
`;

const StatBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
`;

const StatLabel = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const StatValue = styled.span<{ $critical?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  font-size: var(--font-size-sm);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: ${(p) =>
    p.$critical ? "var(--color-status-nogo-bg)" : "var(--color-status-go-fg)"};
`;

const FullBadge = styled.span`
  font-size: var(--font-size-2xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-status-nogo-bg);
`;

const FundsLine = styled.div`
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-6);
`;

const FundsLabel = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const FundsValue = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const Applicant__Row = styled.li`
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-4) var(--space-8);
  background: var(--color-surface-panel);
  border-radius: var(--radius-xs);
`;

const Who = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  gap: var(--space-2);
`;

const Empty = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  padding: var(--space-6) 0;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<AstronautComplexConfig>({
  id: "astronaut-complex",
  name: "Astronaut Complex",
  description:
    "Astronaut Complex: funds, single next-hire cost and the active/max crew cap (unlimited-aware) in the header, then Applicants and Active tabs. Applicants shows each candidate through the shared crew-stat row (trait, courage, stupidity) with a per-row arm-then-confirm Hire action disabled when funds are short or the roster is at the facility cap. Active is itself tabbed, one sub-tab per distinct situation (Available/Assigned/Dead/Missing, plus any mod value) auto-derived from the hired-crew roster, each showing name/role/courage/stupidity/rank/experience-toward-next-rank via the shared crew-stat row. The Available sub-tab additionally carries a per-row arm-then-confirm Fire action (no cost, reversible).",
  tags: ["career", "crew", "kc"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: AstronautComplexComponent,
  dataRequirements: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status.economy.funds",
  ],
  defaultConfig: {},
  actions: astronautComplexActions,
  pushable: true,
});

export { AstronautComplexComponent };
