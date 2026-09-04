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
 * <para><b>Two of RP-1's refusals cannot be drawn before the press, because
 * neither fact is on the wire.</b> RP-1 declines to upgrade five of the nine
 * buildings as buildings at all (it drives their tier itself from the mean of
 * the ones it does upgrade), and it gates individual tiers behind tech nodes
 * from its own `KCTBUILDINGTECHS` config. Both answers live on a private Harmony
 * patch class that only the mod half can call, and `career.status.facilities`
 * carries neither, so a row for either is offered and RP-1 refuses it in its own
 * words naming the alternative. That is the pressable-until-refused rule the
 * build controls follow, and it is the honest shape while the wire is silent:
 * inferring "cosmetic" from a one-fund price would be a name list wearing a
 * price tag.</para>
 */
export function FacilityUpgrades() {
  const available = current(useTelemetry("rp1.available"));
  const career = current(useTelemetry("career.status"));
  const constructions = current(useTelemetry("rp1.constructions"));

  // Unconditional and above the early returns: a hook after one would change
  // count on the first frame RP-1 answers.
  const upgrade = useCommand(RP1_FACILITY_UPGRADE_COMMAND);
  usePanelDelay(upgrade);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const facilities = career?.facilities ?? {};
  const queued = new Set(
    (constructions ?? []).flatMap((row) =>
      row.kind === "FacilityUpgrade" &&
      row.facilityType !== undefined &&
      row.facilityType !== null
        ? [row.facilityType]
        : [],
    ),
  );

  const names = Object.keys(facilities).sort((a, b) =>
    facilityLabel(a).localeCompare(facilityLabel(b)),
  );
  const rows = names.flatMap((name) => {
    const step = nextTier(facilities[name]);
    return step === null || queued.has(name) ? [] : [{ name, step }];
  });

  /* Outside the space centre KSP has not INSTANTIATED the facilities, so every
     tier on this channel is absent and the command's own gate refuses. That is
     about reading them and not about building them: an upgrade already under
     way progresses on universal time wherever the operator is standing, RP-1's
     own MaintenanceHandler.FixedUpdate driving it in the editor, in flight and
     in the tracking station as well as here. It is a state worth naming, since
     an empty section here and a career with nothing left to upgrade look
     identical and only one of them is a reason to go and stand in the space
     centre.

     Asked of whether any facility ANSWERED its tiers, never of whether any has
     a step left. A career whose buildings are all at their ceiling has no step
     left either, and telling that operator to go to the space centre they are
     already standing in would be the confident falsehood this branch exists to
     avoid. */
  const answered = names.some((name) => {
    const entry = facilities[name];
    return (
      magnitudeOf(entry?.currentTier) !== null &&
      magnitudeOf(entry?.maxTier) !== null
    );
  });
  if (names.length > 0 && !answered) {
    return (
      <Section gap="sm">
        <SectionTitle>FACILITY UPGRADES</SectionTitle>
        <Text size="sm" tone="muted">
          KSP puts the space centre's buildings in the scene only at the space
          centre, so their tiers and prices cannot be read from here. Anything
          already under construction keeps building wherever you are.
        </Text>
      </Section>
    );
  }

  return (
    <Section gap="sm">
      <SectionTitle>FACILITY UPGRADES</SectionTitle>

      {/* The balance and the billing rule together, above the rows. The rule is
          the half an operator does not know: every other spend surface in this
          career takes the money at the press, and this one does not. */}
      <Cluster gap="md" justify="start" wrap>
        <Readout>
          <ReadoutCaption>Funds</ReadoutCaption>
          <Unit value={career?.economy?.funds} />
        </Readout>
        <Text size="xs" tone="muted">
          RP-1 bills a construction as it builds, so a short career slows the
          work rather than stopping it.
        </Text>
      </Cluster>

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
 * <para>Null covers three different silences and none of them is a row: a
 * facility already at its ceiling, one whose tiers this producer did not send,
 * and one read from outside the space centre, where KSP has not built the
 * facility and every field arrives absent. The caller distinguishes the last
 * from the first by asking whether ANY facility answered.</para>
 *
 * <para>The tiers are counted the way the operator reads them, one higher than
 * the wire's zero-based index, matching the host widget's own "Lvl N of M" and
 * KSP's own R&amp;D dialog, which calls a fully-upgraded VAB level 3.</para>
 */
function nextTier(entry: CareerFacility | undefined): NextTier | null {
  const tier = magnitudeOf(entry?.currentTier);
  const max = magnitudeOf(entry?.maxTier);
  if (tier === null || max === null || tier >= max) {
    return null;
  }
  return { current: tier + 1, total: max + 1, cost: entry?.upgradeCost };
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
      badge={<Badge severity="info">TIER {step.current + 1}</Badge>}
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
  ],
  requires: "rp1",
  /** Immediately above the construction queue this feeds; see `KscConstruction`
   *  for why the order is declared rather than left to import order. */
  priority: -0.5,
  owner: RP1,
});
