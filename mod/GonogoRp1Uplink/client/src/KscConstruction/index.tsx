import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Rp1ConstructionEntry } from "../__generated__/contract";
import { current } from "../shared/current";
import { ProjectCard, ProjectCardList } from "../shared/ProjectCard";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the consumer
// that would silently receive bare numbers without it.
import "../topics";

/**
 * The other half of an RP-1 schedule, next to the facility upgrades stock lets
 * an operator buy with one click.
 *
 * <para>Stock's question is "can I afford this upgrade". RP-1's is a
 * commitment: a facility upgrade, a new launch complex, a second pad each take
 * months, are billed AS they progress rather than up front, and cannot be
 * cancelled without losing what has already been paid. The host widget's own
 * upgrade control answers none of that, so the money already committed to work
 * in flight is not visible anywhere else.</para>
 *
 * <para>The balance every row here is spending against is the host widget's,
 * drawn once in its header. A copy in this section was the same rule satisfied a
 * second time inside one widget, and read as a defect rather than as care.</para>
 *
 * <para><b>Constructions run at once; the build and research queues do not.</b>
 * RP-1 zeroes a vehicle's rate and a research node's at any queue position but
 * the head, so those two advance one item at a time. A construction's rate does
 * not depend on its position at all, which is why nothing here is rendered as
 * waiting its turn.</para>
 */
export function KscConstruction() {
  const available = current(useTelemetry("rp1.available"));
  const constructions = current(useTelemetry("rp1.constructions"));
  const centres = current(useTelemetry("rp1.centres"));

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const rows = constructions ?? [];
  // Only worth naming a centre when the career has more than one. RP-1 supports
  // several through KSCSwitcher and most careers run one.
  const nameCentres = (centres ?? []).length > 1;
  // A construction row carries its centre's id and not its name, so the name
  // comes off the centres channel this section already reads.
  const centreNames = new Map(
    (centres ?? []).flatMap((centre) =>
      centre.kscName === undefined || centre.kscDisplayName === undefined
        ? []
        : [[centre.kscName, centre.kscDisplayName] as const],
    ),
  );

  return (
    <Section gap="sm">
      {/* SITE, because this section builds the ground: facilities, launch
          complexes and pads. Headed plain CONSTRUCTION it fought with the
          vehicles being integrated elsewhere in the career for the same word,
          and an operator read "Construction: nothing" while watching a rocket
          be built. Nothing here is a vehicle and nothing that is a vehicle
          reaches here. */}
      <SectionTitle>SITE CONSTRUCTION</SectionTitle>
      {rows.length === 0 ? (
        // A real answer, and one worth stating: an empty construction queue and
        // an Uplink that is not reporting look identical if this is left out.
        // A sentence rather than a "nothing" hanging off a label, because the
        // label was the same word as the heading above it.
        <Text size="sm" tone="muted">
          No facility, complex or pad is being built.
        </Text>
      ) : (
        <ProjectCardList>
          {rows.map((row) => (
            <ConstructionRow
              centreNames={centreNames}
              key={rowKey(row)}
              nameCentre={nameCentres}
              row={row}
            />
          ))}
        </ProjectCardList>
      )}
    </Section>
  );
}

/**
 * One thing being built. The kind decides only what the detail line says: the
 * progress, the clock and the money are the same three facts for all three, and
 * an operator comparing a pad against a VAB upgrade is comparing exactly those.
 *
 * <para><b>The shared card, the same one Vehicle Assembly draws a rocket
 * with.</b> As four label/value rows and a bar, three constructions ran
 * together into twelve rows with "Remaining" and "Paid" repeating down them,
 * and telling one item from the next meant counting. A facility upgrade and a
 * rocket under integration are the same shape of thing to an operator, so
 * drawing them two different ways would make one career's work look like two
 * unrelated surfaces.</para>
 */
function ConstructionRow({
  row,
  nameCentre,
  centreNames,
}: Readonly<{
  row: Rp1ConstructionEntry;
  nameCentre: boolean;
  centreNames: ReadonlyMap<string, string>;
}>) {
  const ratio = magnitudeOf(row.progressRatio);
  const label = rowLabel(row);
  const centre =
    nameCentre && row.kscName !== undefined && row.kscName !== null
      ? (centreNames.get(row.kscName) ?? row.kscName)
      : null;

  return (
    // Amber only for work that is going nowhere. Every card here is unfinished
    // by definition, so painting them all as caution would leave the colour
    // saying nothing at the moment it is needed.
    <ProjectCard
      badge={
        <Badge severity="info">{KIND_BADGE[row.kind ?? ""] ?? "WORK"}</Badge>
      }
      detail={
        <>
          <Detail row={row} />
          {centre === null ? null : <> · {centre}</>}
        </>
      }
      name={label}
      progress={{ label: `Construction progress, ${label}`, ratio }}
      tone={row.stalled === true ? "warning" : "go"}
    >
      <Text size="xs" tone="muted">
        <TimeLeft row={row} />
      </Text>

      <Text size="xs" tone="muted">
        {/* Both figures, never a difference: RP-1's own outstanding balance
            runs through a currency query this Uplink will not evaluate, so a
            subtraction here would look like that number and not be it. */}
        paid <Unit value={row.spentCost} /> of <Unit value={row.cost} />
      </Text>

      {row.isModify === true && (
        <Text size="xs" tone="muted">
          <Unit value={row.engineersToReadd} /> engineers off it until it
          finishes
        </Text>
      )}
    </ProjectCard>
  );
}

/**
 * The one phrase that differs by kind. Short because it is a detail line and not
 * a sentence: what a facility upgrade, a new complex and a new pad have in
 * common is everything else on the card, and this is only the word that says
 * which of the three it is.
 */
function Detail({ row }: Readonly<{ row: Rp1ConstructionEntry }>) {
  if (row.kind === "FacilityUpgrade") {
    return (
      <>
        level <Unit value={row.currentLevel} /> to{" "}
        <Unit value={row.targetLevel} />
      </>
    );
  }
  if (row.kind === "LaunchComplex") {
    return row.isModify === true ? <>modification</> : <>new complex</>;
  }
  return <>new pad</>;
}

/**
 * How long, or why there is no answer. Three states rather than two: an ETA, a
 * throttle wound to zero, and a project RP-1 has not costed yet. The last is not
 * a stall, and telling an operator their construction has stopped when RP-1
 * simply has not priced it yet would send them looking for a fault.
 *
 * <para>The duration names its own end. "Remaining 90d" beside "Paid" and
 * "Engineers" was one unlabelled number among three labelled ones, and a reader
 * scanning the card had nothing saying whether 90 days was the work left, the
 * work done, or the booking.</para>
 */
function TimeLeft({ row }: Readonly<{ row: Rp1ConstructionEntry }>) {
  if (row.timeLeftSeconds !== undefined && row.timeLeftSeconds !== null) {
    const throttle = magnitudeOf(row.workRate);
    return (
      <>
        <Countdown value={row.timeLeftSeconds} /> until it is finished
        {throttle !== null && throttle > 1 && (
          <>
            {" "}
            <Badge severity="caution">RUSHING</Badge>
          </>
        )}
        {throttle !== null && throttle > 0 && throttle < 1 && (
          <>
            {", at "}
            <Unit value={row.workRate} />
          </>
        )}
      </>
    );
  }
  if (row.stalled === true) {
    return (
      <>
        <Badge severity="caution">STALLED</Badge> no end date while work is
        stopped
      </>
    );
  }
  return <>{NULL_DISPLAY} RP-1 has not costed this yet</>;
}

/** What each RP-1 construction kind is, in a word an operator scans for. */
const KIND_BADGE: Readonly<Record<string, string>> = {
  FacilityUpgrade: "FACILITY",
  LaunchComplex: "COMPLEX",
  Pad: "PAD",
};

/**
 * KSP's facility enum, spelled the way the building is signposted.
 *
 * RP-1's own list writes these out through a localised lookup that reaches KSP,
 * which a reflection-only Uplink cannot call, so the stored name arrives as the
 * enum member and "VehicleAssemblyBuilding" is not a thing anybody says. A
 * facility the table does not know falls back to the stored name rather than to
 * a dash: an unrecognised building still has to be identifiable.
 */
const FACILITY_LABEL: Readonly<Record<string, string>> = {
  Administration: "Administration",
  AstronautComplex: "Astronaut Complex",
  LaunchPad: "Launch Pad",
  MissionControl: "Mission Control",
  ResearchAndDevelopment: "Research and Development",
  Runway: "Runway",
  SpaceplaneHangar: "Spaceplane Hangar",
  TrackingStation: "Tracking Station",
  VehicleAssemblyBuilding: "Vehicle Assembly Building",
};

/**
 * What to call this row. A launch complex and a pad are named by their operator,
 * so RP-1's stored name is already the right words; a facility is named by its
 * enum member and is not.
 */
function rowLabel(row: Rp1ConstructionEntry): string {
  if (row.facilityType !== undefined && row.facilityType !== null) {
    return FACILITY_LABEL[row.facilityType] ?? row.name ?? row.facilityType;
  }
  return row.name ?? NULL_DISPLAY;
}

/** A stable key without inventing an identity the wire does not carry. */
function rowKey(row: Rp1ConstructionEntry): string {
  return `${row.kind ?? ""}:${row.kscName ?? ""}:${row.lcId ?? ""}:${row.padId ?? ""}:${row.name ?? ""}`;
}

registerAugment({
  id: "rp1-ksc-construction",
  augments: "space-center-status.sections",
  component: KscConstruction,
  // Ahead of the launch complexes, rather than left to whichever module the
  // bundler happened to evaluate first: a construction is work the career has
  // already committed money to, and a complex's rush mode is a setting. An
  // order that depends on import order is one a formatter can reverse.
  priority: 0,
  owner: RP1,
});
