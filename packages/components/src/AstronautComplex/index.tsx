import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  registerComponent,
  useActionInput,
} from "@ksp-gonogo/core";
import { META_VANTAGE, useCommand } from "@ksp-gonogo/sitrep-client";
import {
  CREW_STANDING_ORDER,
  CrewStanding,
  canBeSacked,
  crewStandingFromRosterStatus,
  crewStandingLabel,
  stillTrue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  AutoEmptyState,
  Badge,
  Card,
  Cluster,
  CommandButton,
  type CommandButtonHandle,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Stack,
  Stat,
  StatContributions,
  StatStrip,
  speakQuantity,
  type TabDescriptor,
  Tabs,
  Unit,
  usePanelDelay,
  useSlotBound,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  FundsDrain,
  netFundsPerDay,
  reportsFundsDrain,
} from "../shared/FundsDrain";
import { type KerbalStatFields, KerbalStats } from "../shared/KerbalStats";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";

const topics = defineTopicManifest({
  channels: [
    "spaceCenter.astronautComplex",
    "spaceCenter.crewRoster",
    "career.status",
  ],
  // Funds is the only thing drawn off `career.status`.
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
 * The `astronaut-complex.crew` slot contract: a per-kerbal cell under the name,
 * in both lists, for the schedule a career overhaul owns (retirement, a course
 * ETA, lapsing training) and stock has none of. Keyed by NAME, the join key on
 * `spaceCenter.crewRoster`.
 */
export interface AstronautComplexCrewContext {
  /** `ProtoCrewMember.name`: the join key to the augment's own crew channel. */
  kerbalName: string;
  /** `CrewStanding`, or null when the producer sent none. */
  standing: number | null;
  /** Whether this row is a hireable candidate rather than owned crew. */
  isApplicant: boolean;
}

// Declaration-merge each slot id onto its props type in core's `SlotRegistry`; `astronaut-complex.training` is a whole tab and passes nothing.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "astronaut-complex.crew": AstronautComplexCrewContext;
    "astronaut-complex.crew-badge": AstronautComplexCrewContext;
    "astronaut-complex.training": Record<string, never>;
  }
}

/**
 * The `astronaut-complex.crew-badge` slot: the top-right corner of a kerbal's
 * card, a mark read WITH the name while scanning, where the crew slot is a
 * block read once settled on a kerbal. Stock puts nothing here: a career
 * overhaul's states (a naut mid-course still reads `Available` to KSP) cannot
 * be derived by the host. Same props as the crew slot.
 */
const ASTRONAUT_COMPLEX_CREW_BADGE_SLOT = "astronaut-complex.crew-badge";

/** KSP's `int.MaxValue`, which `GameVariables.GetActiveCrewLimit` returns for an unlimited roster; every tiered cap sits far below it. */
const UNLIMITED_CREW_CAP = 2_147_483_647;

/**
 * The `astronaut-complex.training` slot: a whole TAB beside Applicants and
 * Active, absent until an Uplink claims it, since stock has no crew training.
 * A course is a thing in its own right that several kerbals share. No props.
 */
const ASTRONAUT_COMPLEX_TRAINING_SLOT = "astronaut-complex.training";

/**
 * The `astronaut-complex.readouts` contribution slot: further cells in the
 * core-stat strip. A contribution, not an augment, so the host draws every
 * cell with its own `Stat` and a contributed figure is indistinguishable from
 * a built-in one.
 */
const ASTRONAUT_COMPLEX_READOUTS_SLOT = "astronaut-complex.readouts";

const NO_SEGMENT_PROPS: Record<string, never> = Object.freeze({});

/** Shown whenever a stale balance is withheld. Hiring stays available: the game arbitrates the purchase. */
const FUNDS_STALE_NOTE = "Funds no longer current";

/**
 * Firing from a bound input is "cycle then act": `highlightNextAvailable` walks
 * the highlight over every sackable crew member, and `fireHighlighted` arms on
 * its first press and fires on its second. Moving the highlight disarms.
 */
const astronautComplexActions = [
  {
    id: "highlightNextAvailable",
    label: "Next available crew",
    accepts: ["button"],
    description:
      "Cycles the highlighted crew member, among those who can be fired: the target fireHighlighted acts on.",
  },
  {
    id: "fireHighlighted",
    label: "Fire highlighted crew",
    accepts: ["button"],
    description:
      "First press arms, second press fires the highlighted crew member back to the applicant pool.",
  },
] as const satisfies readonly ActionDefinition[];

type AstronautComplexActions = typeof astronautComplexActions;

interface Applicant {
  name: string;
  trait: string;
  /** Retained from the wire and withheld from display; `null` when the pool quoted none. */
  experienceLevel: number | null;
  courage: number | null;
  stupidity: number | null;
  roleDescription: string;
  descriptionEffects: string;
}

/** An applicant's fields; the stats that do not apply to someone not yet hired take their safe zero, and rank is withheld from display. */
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
    // Never rendered while available is true; the pool's implicit standing.
    situation: "Applicant",
    standing: CrewStanding.Applicant,
    // An applicant has no RosterStatus: null is the fact, not a missing read.
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
   * Every field on the complex record is a fact that only an event moves, so
   * the record takes `stillTrue` whole: a blanked pool would report no
   * candidates for a save that has four waiting.
   */
  const complexReading = topics.useTelemetry("spaceCenter.astronautComplex");
  const complex = stillTrue(complexReading, undefined);
  // `absent` is off career; `pending` is a cold start and gets its own sentence.
  const complexConfirmedEmpty = complexReading.state === "absent";
  /**
   * Funds is the one judgement here: it sits beside a spend control and decides
   * `affordable`, so a held balance is withheld, with `fundsNotCurrent` saying
   * why it is missing.
   */
  const fundsReading = topics.useTelemetry("career.status");
  const careerEconomy =
    fundsReading.state === "observed" ? fundsReading.value.economy : undefined;
  const careerFunds = magnitudeOf(careerEconomy?.funds);
  // The note explains a MISSING figure, so it is on exactly when a held figure is withheld.
  const fundsNotCurrent = fundsReading.state === "stale";
  // Crew are a standing cost: the rate from whichever money model won `economy`; stock reports none.
  const netFunds = netFundsPerDay(careerEconomy);
  // A kerbal is on the books until an event takes them off, so the last roster received stands.
  const crewRosterRaw = stillTrue(
    topics.useTelemetry("spaceCenter.crewRoster"),
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
  usePanelDelay(hireCmd);

  // Firing is the same kind of KSC ground action: instant and free.
  const fireCmd = useCommand("career.crew.fire", { vantage: META_VANTAGE });
  usePanelDelay(fireCmd);

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
  const canHire = affordable && !rosterFull;

  /**
   * The lines qualifying the funds figure, composed only when there is one:
   * an empty detail line would still take its height and lift the figure out of
   * line with the rest of the strip.
   */
  const fundsDetail: ReactNode =
    reportsFundsDrain(netFunds) || fundsNotCurrent ? (
      <>
        <FundsDrain funds={careerFunds} netPerDay={netFunds} />
        {fundsNotCurrent && <ReadoutCaption>{FUNDS_STALE_NOTE}</ReadoutCaption>}
      </>
    ) : undefined;

  const fundsStat = (
    <Stat label="Funds" detail={fundsDetail}>
      {careerFunds !== null ? (
        <span
          title={speakQuantity(value("funds", careerFunds), { decimals: 0 })}
        >
          <Unit value={value("funds", careerFunds)} />
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

  const capText = capUnlimited
    ? "Unlimited"
    : capKnown
      ? String(crewCapacity)
      : null;

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
                  <Unit value={value("funds", nextHireCost)} />
                </span>
              ) : (
                NULL_DISPLAY
              )}
            </Stat>
            <Stat label="Active Kerbals" tone={rosterFull ? "nogo" : "neutral"}>
              {activeCrew !== null ? activeCrew : NULL_DISPLAY}
              {capText !== null ? ` / ${capText}` : ""}
              {rosterFull && (
                <Badge severity="critical" size="sm">
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
                      content: (
                        /* Rows spaced like the other tabs, and an empty state: a claimed slot is not a filled one, and only `AutoEmptyState` can tell. */
                        <AutoEmptyState
                          fallback={
                            <div style={EMPTY_STYLE}>No training right now</div>
                          }
                          gap="section-compact"
                        >
                          <AugmentSlot
                            name={ASTRONAUT_COMPLEX_TRAINING_SLOT}
                            props={NO_SEGMENT_PROPS}
                          />
                        </AutoEmptyState>
                      ),
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
  /** The shared hire handle; each row's own `CommandButton` holds that applicant's arm and in-flight state. */
  hireCmd: CommandButtonHandle;
}) {
  if (applicants.length === 0) {
    return <div style={EMPTY_STYLE}>No applicants right now</div>;
  }
  return (
    <Stack as="ul" style={LIST_STYLE}>
      {applicants.map((a) => (
        // Kerbal names are unique within the applicant pool, so the name is a stable key.
        <Card as="li" key={a.name}>
          {/* Hand-composed so the KerbalStats block does not inherit the heading type; the corner holds the career model's mark, then the action. */}
          <Card.TitleRow
            right={
              <Cluster align="center">
                <AugmentSlot
                  name={ASTRONAUT_COMPLEX_CREW_BADGE_SLOT}
                  props={{
                    kerbalName: a.name,
                    standing: CrewStanding.Applicant,
                    isApplicant: true,
                  }}
                />
                <HireButton
                  applicantName={a.name}
                  hireCost={hireCost}
                  enabled={canHire}
                  disabledReason={
                    rosterFull
                      ? "Roster full"
                      : hireCost === null
                        ? "Hire price not quoted"
                        : !affordable
                          ? "Insufficient funds"
                          : undefined
                  }
                  hireCmd={hireCmd}
                />
              </Cluster>
            }
          >
            <Stack style={WHO_STYLE}>
              <KerbalStats
                kerbal={applicantStats(a)}
                showRank={false}
                showTraits
                showInfo
              />
            </Stack>
          </Card.TitleRow>
          {/* An applicant has a schedule too under a career overhaul, flagged so an augment knows which list it is in. */}
          <AugmentSlot
            name="astronaut-complex.crew"
            props={{
              kerbalName: a.name,
              standing: CrewStanding.Applicant,
              isApplicant: true,
            }}
          />
        </Card>
      ))}
    </Stack>
  );
}

/**
 * The Active tab, sub-tabbed by the `CrewStanding` values actually present, so
 * no tab is ever empty and a new standing gets a tab with no edit. Grouped by
 * STANDING, not KSP's roster status: RP-1 writes `Dead` into the roster status
 * of a living retiree.
 */
function ActivePanel({
  crew,
  fireCmd,
  highlightedName,
  armed,
}: {
  crew: CrewRosterRow[];
  /** The shared fire handle; see `ApplicantsPanel`'s `hireCmd`. */
  fireCmd: CommandButtonHandle;
  /** The crew member `fireHighlighted` acts on. */
  highlightedName: string | null;
  /** Whether that crew member's fire is armed: the next `fireHighlighted` press sends it. */
  armed: boolean;
}) {
  // Filters on the `isApplicant` flag: an absent roster ordinal is a field that did not arrive, not an applicant.
  const active = crew.filter((c) => !c.isApplicant);
  if (active.length === 0) {
    return <div style={EMPTY_STYLE}>No active crew</div>;
  }

  const groups = groupByStanding(active);
  const tabs: TabDescriptor[] = orderStandings(groups.keys()).map(
    (standing) => {
      const members = groups.get(standing) ?? [];
      const keys = crewRowKeys(members);
      // Whether the roster accepts a sacking, which is not whether the kerbal can fly: a resting kerbal can be fired.
      const fireable = canBeSacked(standing);
      const label = crewStandingLabel(standing) ?? members[0]?.situation ?? "";
      return {
        // Named after the standing: stable across re-renders and legible in a test failure.
        id: `standing-${standing}`,
        label: `${label} (${members.length})`,
        content: (
          <Stack as="ul" style={LIST_STYLE}>
            {members.map((m, i) => (
              <Card
                as="li"
                key={keys[i]}
                aria-current={
                  fireable && m.name === highlightedName ? "true" : undefined
                }
              >
                {/* The sack control sits at the END of the identity line: firing is rare, and a column of its own would take width off the schedule. The corner is where a career model's mark is read WITH the name. */}
                <Card.TitleRow
                  right={
                    <Cluster align="center">
                      <AugmentSlot
                        name={ASTRONAUT_COMPLEX_CREW_BADGE_SLOT}
                        props={{
                          kerbalName: m.name,
                          standing: m.standing,
                          isApplicant: false,
                        }}
                      />
                      {fireable && m.name === highlightedName && (
                        <Badge
                          severity={armed ? "critical" : undefined}
                          size="sm"
                        >
                          {armed ? "ARMED" : "SELECTED"}
                        </Badge>
                      )}
                      {fireable && (
                        <FireButton kerbalName={m.name} fireCmd={fireCmd} />
                      )}
                    </Cluster>
                  }
                >
                  <Stack style={WHO_STYLE}>
                    <KerbalStats
                      kerbal={crewRowStats(m)}
                      showRank
                      showTraits
                      showExperienceProgress
                      showInfo
                    />
                  </Stack>
                </Card.TitleRow>
                {/* This kerbal's schedule from whichever Uplink manages their career; nothing under stock. */}
                <AugmentSlot
                  name="astronaut-complex.crew"
                  props={{
                    kerbalName: m.name,
                    standing: m.standing,
                    isApplicant: false,
                  }}
                />
              </Card>
            ))}
          </Stack>
        ),
      };
    },
  );

  return <Tabs tabs={tabs} />;
}

/** Hire: a funds spend, arm-then-confirm via the shared {@link CommandButton}; the wrapper supplies an accessible name that says the cost. */
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
  // The cost lives in the header, so the accessible name still has to say it; words, since it never renders on screen.
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
 * Fire: no cost, but the same two-step commit, since a fire is destructive
 * even though a re-hire restores the kerbal. Renders only on a row whose
 * standing `career.crew.fire` accepts.
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

/** One row from `spaceCenter.crewRoster`, the hired-crew roster. */
interface CrewRosterRow {
  name: string;
  trait: string;
  /** Rank; `null` when none was carried, which renders as a dash rather than rank zero. */
  experienceLevel: number | null;
  /** Display label only, for a row whose {@link standing} this build cannot name. */
  situation: string;
  /** `CrewStanding`: the field every decision reads and the Active tab's grouping key; `null` when none was sent. */
  standing: number | null;
  /** Which provider decided {@link standing}; shown on a corrected row so the operator sees which mod claims a retirement. */
  standingSource: string | null;
  /** KSP's own `RosterStatus` ordinal, carried and never branched on: under RP-1 it reads `Dead` for a living retiree. */
  situationOrdinal: number | null;
  /** `ProtoCrewMember.inactive`, an input to the producer's `Resting` standing; never branched on here. */
  inactive: boolean;
  inactiveUntilUt: number | null;
  /** When {@link standing} lapses, as universal time; absent for a standing with no scheduled end. */
  standingEndsAtUt: number | null;
  /** When this kerbal retires, as universal time; absent where no backend schedules retirements. */
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

/** Badges not on the wire take their safe zero, as {@link applicantStats} does. */
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

/** The tab order, from the SDK's `CREW_STANDING_ORDER`, so a standing added to the contract takes its place with no edit. */
function orderStandings(present: Iterable<number>): number[] {
  const seen = new Set(present);
  const known = CREW_STANDING_ORDER.filter((standing) => seen.has(standing));
  // A standing this build cannot name is still a bucket of real kerbals, so it sorts last rather than being dropped.
  const unknown = [...seen]
    .filter((standing) => !CREW_STANDING_ORDER.includes(standing))
    .sort((a, b) => a - b);
  return [...known, ...unknown];
}

/** Groups active crew by `standing`, one bucket per value present; a row with no standing buckets as `Unknown`. */
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

/** A standing's label: the contract's word, then the producer's label, then a dash, never a bare number. */
function standingLabelOf(row: {
  standing: number | null;
  situation: string;
}): string {
  return crewStandingLabel(row.standing) ?? row.situation ?? "";
}

/** Stable per-row keys: name plus an occurrence count, since a re-hired duplicate name is legal. */
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
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      name: typeof e.name === "string" ? e.name : "",
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOf(asQuantityish(e.experienceLevel)),
      situation: typeof e.situation === "string" ? e.situation : "",
      // Absent only from a mod build without the crew-standing capability, so fall back to KSP's roster status.
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
      inactiveUntilUt: magnitudeOf(asQuantityish(e.inactiveUntilUt)),
      standingEndsAtUt: magnitudeOf(asQuantityish(e.standingEndsAtUt)),
      retiresAtUt: magnitudeOf(asQuantityish(e.retiresAtUt)),
      isApplicant: e.isApplicant === true,
      available: e.available === true,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
      courage: magnitudeOf(asQuantityish(e.courage)),
      stupidity: magnitudeOf(asQuantityish(e.stupidity)),
      experienceLevelDelta: magnitudeOf(asQuantityish(e.experienceLevelDelta)),
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
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      name: typeof e.name === "string" ? e.name : "",
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOf(asQuantityish(e.experienceLevel)),
      courage: magnitudeOf(asQuantityish(e.courage)),
      stupidity: magnitudeOf(asQuantityish(e.stupidity)),
      roleDescription:
        typeof e.roleDescription === "string" ? e.roleDescription : "",
      descriptionEffects:
        typeof e.descriptionEffects === "string" ? e.descriptionEffects : "",
    });
  }
  return out;
}

// Related gap, so two adjacent card borders do not read as one thick divider.
const LIST_STYLE = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  gap: "var(--gap-related)",
} as const;

// The identity column takes the row's width and lets the name ellipsise.
const WHO_STYLE = {
  minWidth: 0,
  flex: 1,
  gap: "var(--gap-related)",
} as const;

const EMPTY_STYLE = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  padding: "var(--inset-empty-roster)",
} as const;

registerComponent<AstronautComplexConfig>({
  id: "astronaut-complex",
  name: "Astronaut Complex",
  description:
    "Astronaut Complex: funds, single next-hire cost and the active/max crew cap (unlimited-aware) in a core-stat strip, then Applicants and Active tabs. The strip takes further cells from the astronaut-complex.readouts contribution slot, so the career model running the save can put what IT considers core beside the three vanilla figures, in the same cell treatment and the same row. Applicants shows each candidate through the shared crew-stat row (trait, courage, stupidity) with a per-row arm-then-confirm Hire action disabled when funds are short or the roster is at the facility cap. Active is itself tabbed, one sub-tab per CrewStanding present on the roster (Available/Assigned/Retired/Dead/Missing), each showing name/role/courage/stupidity/rank/experience-toward-next-rank via the shared crew-stat row, plus a RESTING badge for a kerbal standing down after a flight. The Available sub-tab additionally carries an arm-then-confirm Fire action at the end of each identity line (no cost, reversible). Every row exposes an astronaut-complex.crew augment slot so a career-overhaul Uplink can render that kerbal's retirement date, training ETA and lapsing training, and an astronaut-complex.crew-badge slot at the top right of the same card for a mark that has to be read WITH the name while scanning the roster rather than in the block underneath it. An astronaut-complex.training slot adds a whole tab beside Applicants and Active for the courses that career is running.",
  tags: ["career", "crew", "kc"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 4 },
  component: AstronautComplexComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: astronautComplexActions,
  augmentSlots: [
    "astronaut-complex.crew",
    ASTRONAUT_COMPLEX_CREW_BADGE_SLOT,
    ASTRONAUT_COMPLEX_TRAINING_SLOT,
  ],
  contributionSlots: [ASTRONAUT_COMPLEX_READOUTS_SLOT],
  pushable: true,
});

export { AstronautComplexComponent };
