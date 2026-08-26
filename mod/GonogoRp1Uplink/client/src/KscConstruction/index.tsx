import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  ProgressBar,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { Rp1ConstructionEntry } from "../__generated__/contract";
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
 * <para>The funds balance sits at the top for the same reason the host widget
 * carries one: every row here is money leaving, and an operator deciding
 * whether to start another should not have to look at a different widget to see
 * what is left.</para>
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
  const career = current(useTelemetry("career.status"));

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const rows = constructions ?? [];
  // Only worth naming a centre when the career has more than one. RP-1 supports
  // several through KSCSwitcher and most careers run one.
  const nameCentres = (centres ?? []).length > 1;

  return (
    <Section>
      <SectionTitle>RP-1 KSC CONSTRUCTION</SectionTitle>
      <Stack as="ul" gap="sm" style={LIST_STYLE}>
        <Row>
          <RowName>Funds</RowName>
          <Text>
            <Unit value={career?.economy?.funds} />
          </Text>
        </Row>

        {rows.length === 0 ? (
          <Row>
            <RowName>Under construction</RowName>
            {/* A real answer, and one worth stating: an empty construction
                queue and an Uplink that is not reporting look identical if this
                row is simply left out. */}
            <Text>nothing</Text>
          </Row>
        ) : (
          rows.map((row) => (
            <ConstructionRow
              key={rowKey(row)}
              nameCentre={nameCentres}
              row={row}
            />
          ))
        )}
      </Stack>
    </Section>
  );
}

/**
 * One thing being built. The kind decides only what the detail line says: the
 * progress, the clock and the money are the same three facts for all three, and
 * an operator comparing a pad against a VAB upgrade is comparing exactly those.
 */
function ConstructionRow({
  row,
  nameCentre,
}: Readonly<{ row: Rp1ConstructionEntry; nameCentre: boolean }>) {
  const ratio = magnitudeOf(row.progressRatio);
  const label = rowLabel(row);

  return (
    <Stack as="li" gap="xs">
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        <Row>
          <RowName>
            {label}
            {nameCentre && row.kscName !== undefined && row.kscName !== null
              ? ` · ${row.kscName}`
              : ""}
          </RowName>
          <Text>
            <Badge severity="info">
              {KIND_BADGE[row.kind ?? ""] ?? "WORK"}
            </Badge>{" "}
            <Detail row={row} />
          </Text>
        </Row>
        <Row>
          <RowName>Remaining</RowName>
          <Text>
            <TimeLeft row={row} />
          </Text>
        </Row>
        {row.isModify === true && (
          <Row>
            {/* Its own row rather than appended to the detail above. A sentence
                long enough to wrap takes the whole width of a Row and squeezes
                the name out of it entirely, which a markup assertion cannot
                see and a render can. */}
            <RowName>Engineers</RowName>
            <Text>
              <Unit value={row.engineersToReadd} /> off it until it finishes
            </Text>
          </Row>
        )}
        <Row>
          <RowName>Paid</RowName>
          <Text>
            {/* Both figures, never a difference: RP-1's own outstanding balance
                runs through a currency query this Uplink will not evaluate, so a
                subtraction here would look like that number and not be it. */}
            <Unit value={row.spentCost} /> of <Unit value={row.cost} />
          </Text>
        </Row>
      </Stack>
      {/* Outside the list: a progressbar is not a list item. */}
      {ratio !== null && (
        <ProgressBar
          ariaLabel={`Construction progress, ${label}`}
          value={ratio * 100}
        />
      )}
    </Stack>
  );
}

/**
 * The one phrase that differs by kind, and it is kept SHORT on purpose: it
 * shares a row with the name, and a phrase long enough to wrap takes the whole
 * width and leaves the name with none. Anything that needs a sentence gets a row
 * of its own.
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
 */
function TimeLeft({ row }: Readonly<{ row: Rp1ConstructionEntry }>) {
  if (row.timeLeftSeconds !== undefined && row.timeLeftSeconds !== null) {
    const throttle = magnitudeOf(row.workRate);
    return (
      <>
        <Countdown value={row.timeLeftSeconds} />
        {throttle !== null && throttle > 1 && (
          <>
            {" "}
            <Badge severity="caution">RUSHING</Badge>
          </>
        )}
        {throttle !== null && throttle > 0 && throttle < 1 && (
          <>
            {" at "}
            <Unit value={row.workRate} />
          </>
        )}
      </>
    );
  }
  if (row.stalled === true) {
    return <Badge severity="caution">STALLED</Badge>;
  }
  return <>{NULL_DISPLAY} not costed yet</>;
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

/**
 * A Row renders an `<li>`, so its rows need list semantics around them; see
 * LaunchComplexStatus for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;

/** A stable key without inventing an identity the wire does not carry. */
function rowKey(row: Rp1ConstructionEntry): string {
  return `${row.kind ?? ""}:${row.kscName ?? ""}:${row.lcId ?? ""}:${row.padId ?? ""}:${row.name ?? ""}`;
}

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-ksc-construction",
  augments: "space-center-status.sections",
  component: KscConstruction,
  owner: RP1,
});
