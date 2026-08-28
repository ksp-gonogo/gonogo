import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useActionInput,
} from "@ksp-gonogo/core";
import {
  META_VANTAGE,
  type Reading,
  useCommand,
} from "@ksp-gonogo/sitrep-client";
import {
  CREW_STANDING_ORDER,
  CrewStanding,
  canBeSacked,
  crewStandingFromRosterStatus,
  crewStandingLabel,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  type CommandButtonHandle,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  speakQuantity,
  type TabDescriptor,
  Tabs,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { FundsDrain, netFundsPerDay } from "../shared/FundsDrain";
import { type KerbalStatFields, KerbalStats } from "../shared/KerbalStats";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status",
  ],
  // Funds is the only thing drawn off `career.status`; the contracts, tech and
  // strategy fields on it belong to other widgets and their alarms are not
  // about this panel.
  fields: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status.economy.funds",
    "career.status.economy.subsidyPerDay",
    "career.status.economy.upkeepPerDay",
  ],
});

type AstronautComplexConfig = Record<string, never>;

/**
 * The `astronaut-complex.crew` slot contract: a per-kerbal cell rendered under
 * the name, in both the Applicants and the Active lists.
 *
 * <p>Its reason for existing is what stock does NOT have. Under stock a kerbal's
 * whole state is their standing and their stats, both of which this widget
 * already renders. Under a career overhaul they also have a retirement date, a
 * training course with an ETA, and training about to lapse, and none of that is
 * core's to model or to name. So the host renders the roster and passes down
 * the identity; whichever Uplink manages the career renders the schedule.</p>
 *
 * <p>The identity is the NAME, because that is the key every career-overhaul
 * mod on record uses for its own crew bookkeeping and it is the join key on
 * `spaceCenter.crewRoster`. The standing rides along so an augment can render
 * differently for a retiree without joining back to the roster itself.</p>
 */
export interface AstronautComplexCrewContext {
  /** `ProtoCrewMember.name`: the join key to the augment's own crew channel. */
  kerbalName: string;
  /** `CrewStanding`, or null when the producer sent none. */
  standing: number | null;
  /** Whether this row is a hireable candidate rather than owned crew. */
  isApplicant: boolean;
}

// Declaration-merge the slot id onto its props type in core's `SlotRegistry`.
// Co-located here (not a shared central file) so parallel slot work on other
// widgets can't collide. Makes `registerAugment({ augments:
// "astronaut-complex.crew" })` and `<AugmentSlot name="astronaut-complex.crew"
// props={...} />` type-check against `AstronautComplexCrewContext` rather than
// the loose fallback.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "astronaut-complex.crew": AstronautComplexCrewContext;
  }
}

/**
 * KSP's `int.MaxValue`, the literal sentinel `GameVariables.GetActiveCrewLimit`
 * returns at the top Astronaut Complex tier (an unlimited roster). The mod
 * preserves it verbatim on the wire, so a `>= int.MaxValue` floor guard is the
 * correct test: every real save's tiered cap sits far below it (tier 1 caps
 * at 5, tier 2 at 13), so there is no risk of a legitimate cap reading as
 * unlimited.
 */
const UNLIMITED_CREW_CAP = 2_147_483_647;

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
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

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
    standing: CrewStanding.Applicant,
    // An applicant is not in the roster, so it has no RosterStatus. Null is
    // the fact, not a missing read.
    situationOrdinal: null,
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
  const complexReading = topics.useTelemetry("spaceCenter.astronautComplex");
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
  const fundsReading = topics.useTelemetry("career.status");
  const careerFunds = magnitudeOf(judgeable(fundsReading)?.economy?.funds);
  const fundsNotCurrent = notCurrent(fundsReading);
  /**
   * Crew are a standing cost, not a one-off: a hire this balance covers today
   * adds to a payroll the same balance keeps paying. The rate comes from
   * whichever money model won the `economy` capability, so a stock career, which
   * charges nothing to keep a kerbal on the books, reports nothing here.
   */
  const netFunds = netFundsPerDay(judgeable(fundsReading)?.economy);
  /**
   * The hired-crew roster is the textbook fact: a kerbal is on the books until
   * an event takes them off, so the last roster received is still the roster.
   */
  const crewRosterRaw = stillTrue(
    topics.useTelemetry("spaceCenter.crewRoster"),
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
    () => crewRoster.filter((c) => c.standing === CrewStanding.Available),
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
      <Panel
        panelTitle="ASTRONAUT COMPLEX"
        compactTitle={["ASTRONAUTS", "CREW"]}
      >
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
            <FundsDrain funds={careerFunds} netPerDay={netFunds} />
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
    <Panel panelTitle="ASTRONAUT COMPLEX" compactTitle={["ASTRONAUTS", "CREW"]}>
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
            <DrainLine>
              <FundsDrain funds={careerFunds} netPerDay={netFunds} />
            </DrainLine>
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
  hireCmd,
}: {
  applicants: Applicant[];
  affordable: boolean;
  canHire: boolean;
  rosterFull: boolean;
  hireCost: number | null;
  /**
   * The shared hire handle. Each row's own `CommandButton` holds the arm and
   * in-flight state for THAT applicant, so a hire in flight shows on the row it
   * was issued from rather than on all of them.
   */
  hireCmd: CommandButtonHandle;
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
            {/* An applicant has a schedule too under a career overhaul: RP-1
                gives an applicant a retirement date and retires them out of the
                pool. Same slot as the Active rows, flagged so an augment can
                tell which list it is in. */}
            <AugmentSlot
              name="astronaut-complex.crew"
              props={{
                kerbalName: a.name,
                standing: CrewStanding.Applicant,
                isApplicant: true,
              }}
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
            hireCmd={hireCmd}
          />
        </Applicant__Row>
      ))}
    </List>
  );
}

/**
 * The Active tab: itself tabbed, one sub-tab per `CrewStanding` actually present
 * on the hired-crew roster. A standing with zero members has no bucket, so it
 * never produces an empty tab, and a standing added to the contract gets a tab
 * with no edit here.
 *
 * <p>It groups by the STANDING rather than by KSP's roster status, which is the
 * fix for the defect this widget shipped with: RP-1 retires a kerbal by writing
 * stock's `Dead` into the roster status, so every RP-1 retiree sat in the Dead
 * tab wearing a red fatality badge. Retired is its own tab now because it is its
 * own fact.</p>
 *
 * Composition: ONE underlying `crew` array, sliced per standing for each
 * tab's content, rather than a `FilterBar` toggle group layered over a single
 * flat list. The shared `Tabs` primitive already IS the mutually-exclusive
 * filter switch here, so the standings read as tabs, matching the top-level
 * Applicants|Active split one level up rather than introducing a second
 * filtering idiom for the same shape of decision.
 */
function ActivePanel({
  crew,
  fireCmd,
  highlightedFireIndex,
}: {
  crew: CrewRosterRow[];
  /** The shared fire handle; see `ApplicantsPanel`'s `hireCmd`. */
  fireCmd: CommandButtonHandle;
  highlightedFireIndex: number;
}) {
  // Defensive, not load-bearing: spaceCenter.crewRoster never actually
  // carries an applicant (that only appears in the astronautComplex pool),
  // but filtering them out here keeps this panel correct even if a future
  // producer ever merges the two channels. Reads the `isApplicant` FLAG rather
  // than the "Applicant" label, and rather than a null roster ordinal: an
  // absent ordinal is a field that did not arrive, which is not the same fact
  // and must not empty the panel.
  const active = crew.filter((c) => !c.isApplicant);
  if (active.length === 0) {
    return <Empty>No active crew</Empty>;
  }

  const groups = groupByStanding(active);
  const tabs: TabDescriptor[] = orderStandings(groups.keys()).map(
    (standing) => {
      const members = groups.get(standing) ?? [];
      const keys = crewRowKeys(members);
      // Whether the roster will accept a sacking, which is NOT whether the
      // kerbal can fly. This used to read `standing === Available`, and the two
      // questions only looked like one while a stand-down and a training course
      // were invisible to the standing: once they became standings, that
      // expression quietly took the Fire control away from every kerbal resting
      // after a flight, which is a normal daily state and a perfectly legitimate
      // thing to fire someone out of. The rule lives in the SDK so the widget
      // does not carry a second copy of it.
      const fireable = canBeSacked(standing);
      const label = crewStandingLabel(standing) ?? members[0]?.situation ?? "";
      return {
        // The tab set is built from whatever standings are present, so each id is
        // the standing's own name, never the array-index fallback: an index can
        // collide across re-renders once the set of present standings changes, a
        // stable id can't. Named rather than numbered so a tab id stays legible
        // in a test failure and in the DOM.
        id: `standing-${standing}`,
        label: `${label} (${members.length})`,
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
                  {/* This kerbal's schedule, contributed by whichever Uplink
                    manages their career: a retirement date, a training ETA,
                    the mission training about to lapse. Nothing renders under
                    stock, which has none of those concepts. */}
                  <AugmentSlot
                    name="astronaut-complex.crew"
                    props={{
                      kerbalName: m.name,
                      standing: m.standing,
                      isApplicant: false,
                    }}
                  />
                </Who>
                {fireable && (
                  <FireButton kerbalName={m.name} fireCmd={fireCmd} />
                )}
              </Applicant__Row>
            ))}
          </List>
        ),
      };
    },
  );

  return <Tabs tabs={tabs} />;
}

/**
 * Hire: a funds SPEND, so it never fires on a single click. Arm, confirm and
 * in-flight all come from the shared {@link CommandButton}; this wrapper exists
 * only for the accessible name, which has to say what hiring costs.
 */
function HireButton({
  applicantName,
  hireCost,
  enabled,
  disabledReason,
  hireCmd,
}: {
  applicantName: string;
  hireCost: number | null;
  enabled: boolean;
  disabledReason?: string;
  hireCmd: CommandButtonHandle;
}) {
  // The cost moved to the header (one figure for the whole pool), so a
  // screen-reader user tabbing straight to the button still needs to hear
  // what hiring costs; speakQuantity (word form) rather than <Unit> because
  // this only ever renders as an accessible name, never on screen.
  const costText =
    hireCost !== null
      ? ` for ${speakQuantity(value("funds", hireCost), { decimals: 0 })}`
      : "";
  const who = applicantName || "applicant";

  return (
    <CommandButton
      handle={hireCmd}
      args={{ applicantName }}
      commandLabel={`Hire ${who}`}
      size="sm"
      label="Hire"
      confirmLabel="Confirm"
      pendingLabel="Hiring..."
      disabled={!enabled}
      title={enabled ? undefined : disabledReason}
      aria-label={
        enabled
          ? `Hire ${who}${costText}`
          : `Hire ${who}${costText} (${disabledReason ?? "unavailable"})`
      }
      confirmAriaLabel={`Confirm hire of ${who}${costText}`}
      pendingAriaLabel={`Hiring ${who}`}
    />
  );
}

/**
 * Fire: the inverse of {@link HireButton}, no cost (so no figure to speak in
 * the accessible name) but the same two-step commit, because a fire is
 * destructive enough to warrant one even though it is reversible (a re-hire
 * brings the kerbal back with their stats intact). Always enabled: it only ever
 * renders on an Available row, the one roster standing `career.crew.fire`
 * accepts.
 */
function FireButton({
  kerbalName,
  fireCmd,
}: {
  kerbalName: string;
  fireCmd: CommandButtonHandle;
}) {
  const who = kerbalName || "crew member";
  return (
    <CommandButton
      handle={fireCmd}
      args={{ kerbalName }}
      commandLabel={`Fire ${who}`}
      size="sm"
      label="Fire"
      confirmLabel="Confirm"
      confirmTone="nogo"
      pendingLabel="Firing..."
      aria-label={`Fire ${who}`}
      confirmAriaLabel={`Confirm fire of ${who}`}
      pendingAriaLabel={`Firing ${who}`}
    />
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
  /** Display label only, and only for a row whose {@link standing} this build
   *  cannot name; every tab label comes from the standing instead. */
  situation: string;
  /** `CrewStanding`: the field every DECISION here reads, and the Active tab's
   *  grouping key. `null` for a producer that sent none, which is why the
   *  applicant test below reads {@link isApplicant} instead of this. */
  standing: number | null;
  /** Which provider decided {@link standing} (`"stock"`, `"rp1"`, …); `null`
   *  when the capture named none. Shown on a corrected row, so an operator can
   *  see which mod is claiming their astronaut retired rather than died. */
  standingSource: string | null;
  /** KSP's own `RosterStatus` ordinal. Carried, never branched on: under RP-1 it
   *  reads `Dead` for a living retiree. */
  situationOrdinal: number | null;
  /** Standing down for rest (`ProtoCrewMember.inactive`): KSP's own field,
   *  carried like {@link situationOrdinal} and branched on no more than it is.
   *  It is an INPUT to the producer's derivation, which turns it into a
   *  `Resting` {@link standing} with {@link available} false. */
  inactive: boolean;
  inactiveUntilUt: number | null;
  /** When {@link standing} lapses, as universal time: a course's ETA, a rest
   *  period's end. Absent for a standing with no scheduled end. */
  standingEndsAtUt: number | null;
  /** When this kerbal is scheduled to retire, as universal time. Absent under
   *  any backend that does not schedule retirements, stock included. */
  retiresAtUt: number | null;
  /** Whether the row is a hireable candidate rather than owned crew. */
  isApplicant: boolean;
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
    situation: standingLabelOf(c),
    standing: c.standing,
    situationOrdinal: c.situationOrdinal,
    standingEndsAtUt: c.standingEndsAtUt,
    currentVesselName: "",
    courage: c.courage,
    stupidity: c.stupidity,
    experienceLevelDelta: c.experienceLevelDelta,
    roleDescription: c.roleDescription,
    descriptionEffects: c.descriptionEffects,
  };
}

/**
 * The tab order, taken from `CREW_STANDING_ORDER` in the SDK, which derives it
 * from the contract enum's own numbering. A standing added to the contract takes
 * a place here with no edit.
 *
 * The predecessor derived the same list from KSP's `RosterStatus` and carried a
 * comment promising a mod's "Retired" a tab for free. It never got one: RP-1
 * appends no roster status, it writes stock's `Dead`, so the mechanism was
 * sound and the premise was false. Ordering off the STANDING is what actually
 * delivers what that comment claimed.
 */
function orderStandings(present: Iterable<number>): number[] {
  const seen = new Set(present);
  const known = CREW_STANDING_ORDER.filter((standing) => seen.has(standing));
  // A standing this build cannot name is still a bucket of real kerbals, so it
  // sorts after the known ones rather than being dropped.
  const unknown = [...seen]
    .filter((standing) => !CREW_STANDING_ORDER.includes(standing))
    .sort((a, b) => a - b);
  return [...known, ...unknown];
}

/** Groups active crew by `standing`, one bucket per value actually present, so
 *  a standing with zero members produces no bucket and never renders an empty
 *  tab. A row whose standing did not arrive is bucketed as `Unknown`, which is
 *  the standing the producer would have sent for it. */
function groupByStanding(
  crew: readonly CrewRosterRow[],
): Map<number, CrewRosterRow[]> {
  const groups = new Map<number, CrewRosterRow[]>();
  for (const row of crew) {
    const key = row.standing ?? CrewStanding.Unknown;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/**
 * A standing's label: the contract's own word for it, falling back to whatever
 * label the producer sent and then to a dash.
 *
 * The fallback order matters. A standing this build cannot name is a number, and
 * a number is not something to show an operator; the producer's own label is the
 * next best answer, and where there is neither, nothing is said.
 */
function standingLabelOf(row: {
  standing: number | null;
  situation: string;
}): string {
  return crewStandingLabel(row.standing) ?? row.situation ?? "";
}

/** Stable per-row keys for a standing's member list. Kerbal names aren't
 *  guaranteed unique within a standing (a re-hired duplicate is legal), so
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
      // Absent only from a mod build older than the crew-standing capability.
      // Falling back to KSP's roster status keeps that case reading exactly as
      // it did before the capability existed, rather than bucketing the whole
      // roster as Unknown; see `crewStandingFromRosterStatus` for why the
      // fallback invents no retirement.
      standing:
        typeof e.standing === "number"
          ? e.standing
          : typeof e.situationOrdinal === "number" || e.isApplicant === true
            ? crewStandingFromRosterStatus(
                typeof e.situationOrdinal === "number"
                  ? e.situationOrdinal
                  : null,
                e.isApplicant === true,
              )
            : null,
      standingSource:
        typeof e.standingSource === "string" && e.standingSource !== ""
          ? e.standingSource
          : null,
      situationOrdinal:
        typeof e.situationOrdinal === "number" ? e.situationOrdinal : null,
      inactive: e.inactive === true,
      inactiveUntilUt: magnitudeOf(e.inactiveUntilUt as Quantityish),
      standingEndsAtUt: magnitudeOf(e.standingEndsAtUt as Quantityish),
      retiresAtUt: magnitudeOf(e.retiresAtUt as Quantityish),
      isApplicant: e.isApplicant === true,
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

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
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

const DrainLine = styled.span`
  display: block;
  font-size: var(--font-size-2xs);
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

registerComponent<AstronautComplexConfig>({
  id: "astronaut-complex",
  name: "Astronaut Complex",
  description:
    "Astronaut Complex: funds, single next-hire cost and the active/max crew cap (unlimited-aware) in the header, then Applicants and Active tabs. Applicants shows each candidate through the shared crew-stat row (trait, courage, stupidity) with a per-row arm-then-confirm Hire action disabled when funds are short or the roster is at the facility cap. Active is itself tabbed, one sub-tab per CrewStanding present on the roster (Available/Assigned/Retired/Dead/Missing), each showing name/role/courage/stupidity/rank/experience-toward-next-rank via the shared crew-stat row, plus a RESTING badge for a kerbal standing down after a flight. The Available sub-tab additionally carries a per-row arm-then-confirm Fire action (no cost, reversible). Every row exposes an astronaut-complex.crew augment slot so a career-overhaul Uplink can render that kerbal's retirement date, training ETA and lapsing training.",
  tags: ["career", "crew", "kc"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: AstronautComplexComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: astronautComplexActions,
  augmentSlots: ["astronaut-complex.crew"],
  pushable: true,
});

export { AstronautComplexComponent };
