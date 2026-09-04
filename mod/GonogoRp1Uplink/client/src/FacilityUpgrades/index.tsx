import type { CareerFacility } from "@ksp-gonogo/sitrep-sdk";
import {
  magnitudeOf,
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  NULL_DISPLAY,
  Readout,
  ReadoutCaption,
  Section,
  SectionTitle,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { current } from "../shared/current";
import { facilityLabel } from "../shared/facilityLabels";
import { ProjectCard, ProjectCardList } from "../shared/ProjectCard";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";

/**
 * Queue a facility's next tier as an RP-1 construction project. Must match
 * `Rp1FacilityUpgradeCommands`' own command id.
 */
export const RP1_FACILITY_UPGRADE_COMMAND = "rp1.facility.upgrade";

/**
 * The tier an RP-1 career can commit to next, beside the host widget's grid of
 * the tiers it already has.
 *
 * <para><b>Nothing is charged when this is pressed, and that is the fact the
 * whole section is worded around.</b> RP-1 does not sell a facility upgrade: it
 * adds a construction project, and `ConstructionProject.AddProgress` draws the
 * funds down as the work advances, throttling itself to whatever fraction the
 * career can meet at the time. So a short career gets a SLOWER upgrade, never a
 * refused one, and there is no affordability verdict here of any kind. The host
 * widget's own stock control has one and is right to: `career.facility.upgrade`
 * buys a tier outright, which is a different act at a different price, and
 * `Rp1CareerProjectGate` refuses it under a managed save for exactly that
 * reason.</para>
 *
 * <para><b>The balance is in this section rather than borrowed from the
 * host.</b> The construction queue beside this one deliberately leans on the
 * host's figure, because it carries no control at all. This one carries the
 * press, and the host draws its balance only once the widget is four rows tall,
 * so a short Space Center would show a commitment with no money on screen.</para>
 *
 * <para><b>The tiers come off `rp1.facilities`, not off
 * `career.status.facilities`, and that is what lets this section answer away
 * from the space centre.</b> The stock channel reads the live
 * `UpgradeableFacility` objects, which KSP puts in the SPACECENTER scene only;
 * RP-1 reads the level KSP persists in the SAVE and denormalises it against its
 * own config tier count, which is what its upkeep pass does in all four scenes.
 * The stock channel is still read as a fallback, for a career whose RP-1 cost
 * table has not loaded.</para>
 *
 * <para><b>The tiers are readable off-scene; the PRESS is not.</b> Queueing an
 * upgrade needs the live facility for `GetUpgradeCost()` and for the level table
 * that sets the build's duration, so the command's own requirement holds the
 * button dark away from the space centre and says why. Showing the tier and the
 * price with the control refused beats showing nothing at all: the operator can
 * see what the step would cost from wherever they are standing.</para>
 *
 * <para><b>One of RP-1's two refusals is now drawn before the press and the
 * other still cannot be.</b> RP-1 declines to upgrade five of the nine buildings
 * as buildings at all, and `rp1.facilities[].upgradedByRp1` carries that off
 * `Database.LockedFacilities`, so those rows are no longer offered. It also
 * gates individual tiers behind tech nodes from its own `KCTBUILDINGTECHS`
 * config, and that answer lives on a private Harmony patch class nothing puts on
 * the wire, so a row for a gated tier is offered and RP-1 refuses it in its own
 * words naming the node. That is the pressable-until-refused rule the build
 * controls follow, and it is the honest shape while the wire is silent.</para>
 */
export function FacilityUpgrades() {
  const available = current(useTelemetry("rp1.available"));
  const career = current(useTelemetry("career.status"));
  const constructions = current(useTelemetry("rp1.constructions"));
  const facilityTiers = current(useTelemetry("rp1.facilities"));

  // Unconditional and above the early returns: a hook after one would change
  // count on the first frame RP-1 answers.
  const upgrade = useCommand(RP1_FACILITY_UPGRADE_COMMAND);
  usePanelDelay(upgrade);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const queued = new Set(
    (constructions ?? []).flatMap((row) =>
      row.kind === "FacilityUpgrade" &&
      row.facilityType !== undefined &&
      row.facilityType !== null
        ? [row.facilityType]
        : [],
    ),
  );

  /* RP-1's own reading first, and everywhere it answers.
     `career.status.facilities` comes off the live UpgradeableFacility objects,
     which KSP instantiates in the SPACECENTER scene only, so away from the space
     centre every tier and price on it is absent. RP-1 does not read a building
     that way: it denormalises the level KSP persists in the SAVE against a tier
     count out of its own config, and its MaintenanceHandler bills the career off
     exactly that in the editor, in flight and at the tracking station. So
     `rp1.facilities` answers wherever the operator is standing, which is the
     whole reason this section prefers it.

     Falls back rather than merges. The two agree at the space centre, and a
     merge would have to pick a winner per field with nothing to pick on; the
     stock channel is the fallback because it is what a career with RP-1's cost
     table not yet loaded still has. */
  const stockFacilities = career?.facilities ?? {};
  const rp1Tiers = new Map(
    (facilityTiers ?? []).flatMap((row) =>
      row.facility === undefined || row.facility === null
        ? []
        : [[row.facility, row] as const],
    ),
  );

  const names = Array.from(
    new Set([...rp1Tiers.keys(), ...Object.keys(stockFacilities)]),
  ).sort((a, b) => facilityLabel(a).localeCompare(facilityLabel(b)));
  const rows = names.flatMap((name) => {
    const rp1 = rp1Tiers.get(name);
    /* The five RP-1 prices at a single fund under its own "cosmetic only"
       comment. It drives their tier itself from the mean of the ones it does
       upgrade, so a project queued against one would finish almost at once and
       then be overwritten, and RP-1's own menu does not offer them either. This
       used to be offered-until-refused, because the fact was not on the wire;
       it is now. */
    if (rp1?.upgradedByRp1 === false) {
      return [];
    }
    const step =
      rp1 === undefined
        ? nextTier(stockFacilities[name])
        : (nextTier(rp1) ?? nextTier(stockFacilities[name]));
    return step === null || queued.has(name) ? [] : [{ name, step }];
  });

  /* Neither channel answered, which on an RP-1 install is a cold start rather
     than a scene: RP-1's cost table loads once at game load and does not depend
     on where the operator is. Worth naming either way, since an empty section
     and a career with nothing left to upgrade look identical and only one of
     them is a reason to wait.

     Asked of whether any facility ANSWERED its tiers, never of whether any has
     a step left. A career whose buildings are all at their ceiling has no step
     left either, and telling that operator their tiers are unreadable would be
     the confident falsehood this branch exists to avoid. */
  const answered = names.some(
    (name) =>
      answersTiers(rp1Tiers.get(name)) || answersTiers(stockFacilities[name]),
  );
  if (names.length > 0 && !answered) {
    return (
      <Section gap="sm">
        <SectionTitle>FACILITY UPGRADES</SectionTitle>
        <Text size="sm" tone="muted">
          No tiers have arrived for the space centre's buildings yet. Anything
          already under construction keeps building wherever you are.
        </Text>
      </Section>
    );
  }

  return (
    <Section gap="sm">
      <SectionTitle>FACILITY UPGRADES</SectionTitle>

      {/* The balance, above the rows. What the money does here is carried by
          the figures themselves: each price reads "over the build" and the
          confirm reads "Commit", so the progressive bill is in the readouts an
          operator is already looking at rather than in a sentence about it. */}
      <Readout>
        <ReadoutCaption>Funds</ReadoutCaption>
        <Unit value={career?.economy?.funds} />
      </Readout>

      {rows.length === 0 ? (
        /* A real answer and worth stating: a career whose buildings are all at
           their ceiling, or all already queued, reads the same as a section
           that failed to draw if this is left out. */
        <Text size="sm" tone="muted">
          No facility has a tier left to queue.
        </Text>
      ) : (
        <ProjectCardList>
          {rows.map(({ name, step }) => (
            <UpgradeCard
              facility={name}
              handle={upgrade}
              key={name}
              step={step}
            />
          ))}
        </ProjectCardList>
      )}
    </Section>
  );
}

/** The tier a facility could be taken to, and what RP-1 puts on the project. */
interface NextTier {
  /** The tier it is at now, as an operator counts them. */
  current: number;
  /** The number of tiers it has, as an operator counts them. */
  total: number;
  cost: CareerFacility["upgradeCost"];
}

/**
 * The step this facility could take, or null when there is none to take.
 *
 * <para>Null covers two different silences and neither is a row: a facility
 * already at its ceiling, and one whose tiers no channel sent. The caller tells
 * them apart by asking whether ANY facility answered, because a career at its
 * ceiling and a reading that never arrived are the same empty section
 * otherwise.</para>
 *
 * <para><b>The one place a facility tier is converted, and the convention every
 * surface around it follows.</b> Every tier on the wire is KSP's own zero-based
 * facility level: `career.status.facilities[x].currentTier` is
 * `UpgradeableFacility.FacilityLevel`, `maxTier` is `MaxLevel` (the top tier's
 * own index, 2 for a three-tier building), and `rp1.constructions[].currentLevel`
 * is `RP0.FacilityUpgradeProject.currentLevel`, which its own `Abort()` hands
 * straight to `UpgradeableObject.SetLevel`. All three are the same index in the
 * same domain. Operators count from one and so does KSP's own R&amp;D dialog,
 * which calls a fully-upgraded VAB "Level 3", so every number this Uplink and
 * the host widget put on screen is `index + 1`. `current` and `total` here are
 * already converted; the raw index does not leave this function.</para>
 */
function nextTier(entry: TierBearing | undefined): NextTier | null {
  const tier = magnitudeOf(entry?.currentTier);
  const max = magnitudeOf(entry?.maxTier);
  if (tier === null || max === null || tier >= max) {
    return null;
  }
  return { current: tier + 1, total: max + 1, cost: entry?.upgradeCost };
}

/**
 * The three fields a row is drawn from, which both channels carry under the same
 * names and the same zero-based counting. Named rather than left as a union so
 * the reader below does not have to know which channel a row came off.
 */
type TierBearing = Pick<
  CareerFacility,
  "currentTier" | "maxTier" | "upgradeCost"
>;

/**
 * Whether this entry stated a tier AND a ceiling. Both, because a tier without a
 * ceiling cannot say whether there is a step left, and the section's whole
 * "nothing has arrived" branch turns on the difference between an absent reading
 * and a building already at the top.
 */
function answersTiers(entry: TierBearing | undefined): boolean {
  return (
    magnitudeOf(entry?.currentTier) !== null &&
    magnitudeOf(entry?.maxTier) !== null
  );
}

/**
 * One building, its tier, and the press that commits the career to the next one.
 *
 * <para>The card is the shared one, because a facility upgrade the operator is
 * about to commit to and one already under way are the same shape of thing and
 * the queue beside this draws the second with it.</para>
 *
 * <para>Priced with RP-1's own figure. `upgradeCost` is the identical
 * `GetUpgradeCost()` call the command makes, so the number on the confirm is the
 * number that goes onto the project. Absent it, the press is still offered: the
 * command reads the price itself and refuses if it really cannot be had, which
 * is a better answer than a control drawn dark for a reason nobody
 * established.</para>
 */
function UpgradeCard({
  facility,
  handle,
  step,
}: Readonly<{
  facility: string;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  step: NextTier;
}>) {
  const label = facilityLabel(facility);
  return (
    <ProjectCard
      /* TO, because this is the tier the press BUYS and not the tier the
         building is at. Bare "TIER 3" sat 300px under a host grid reading
         "2 / 3" for the same Launch Pad, and an operator read the two numbers
         as a contradiction rather than as a step. The detail line under it
         carries the other end. */
      badge={<Badge severity="info">TO TIER {step.current + 1}</Badge>}
      detail={
        <>
          now at tier {step.current} of {step.total}
        </>
      }
      name={label}
      tone="go"
    >
      <Cluster gap="sm" justify="start" wrap>
        <Text size="xs" tone="muted">
          {step.cost == null ? (
            <>{NULL_DISPLAY} RP-1 has not priced this tier</>
          ) : (
            <>
              <Unit decimals={0} value={step.cost} /> over the build
            </>
          )}
        </Text>
        <CommandButton
          args={{ facility }}
          aria-label={`Queue ${label} tier ${step.current + 1}`}
          commandLabel={`Queue ${label} tier ${step.current + 1}`}
          confirmAriaLabel={`Confirm queueing ${label} tier ${step.current + 1}`}
          confirmLabel={<CommitWording cost={step.cost} />}
          handle={handle}
          label="Queue upgrade"
          size="sm"
        />
      </Cluster>
    </ProjectCard>
  );
}

/**
 * What the confirm press commits to.
 *
 * <para>COMMIT rather than spend, because nothing leaves the treasury at the
 * press: the figure is what the project will draw down over its build, and
 * "spend 112,500f" would tell the operator their balance is about to move.</para>
 */
function CommitWording({
  cost,
}: Readonly<{ cost: CareerFacility["upgradeCost"] }>) {
  if (cost == null) {
    return <>Commit {NULL_DISPLAY}</>;
  }
  return (
    <>
      Commit <Unit decimals={0} value={cost} />
    </>
  );
}

registerAugment({
  id: "rp1-facility-upgrades",
  augments: "space-center-status.sections",
  component: FacilityUpgrades,
  channels: [
    "rp1.available",
    /* The tiers, the prices and the balance all ride this one, and naming it
       here is what makes the section independent of whatever the host happens
       to subscribe. */
    "career.status",
    /* What is already being built, so a facility with a project in flight is
       not offered a second one the command would refuse. */
    "rp1.constructions",
    /* The tiers and prices again, read through RP-1 rather than through the
       scene. The only one of these that answers away from the space centre. */
    "rp1.facilities",
  ],
  requires: "rp1",
  /** Immediately above the construction queue this feeds; see `KscConstruction`
   *  for why the order is declared rather than left to import order. */
  priority: -0.5,
  owner: RP1,
});
