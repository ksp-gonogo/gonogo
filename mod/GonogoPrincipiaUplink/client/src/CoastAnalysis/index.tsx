import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useTelemetry,
  useViewUt,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Countdown,
  Disclosure,
  magnitudeOf,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
import type {
  PrincipiaAnalysis,
  PrincipiaCoastAnalysis,
} from "../__generated__/contract";
import { OrbitAnalysisRows } from "../OrbitAnalysis";
import { orbitDescription } from "../orbitDescription";
import { PRINCIPIA } from "../uplink";
// Side-effect import: hydrates this Topic's units at decode time.
import "../topics";

function coastsOf(
  reading: Reading<PrincipiaAnalysis>,
): PrincipiaCoastAnalysis[] | null {
  switch (reading.state) {
    case "pending":
    case "absent":
    case "unowned":
      return null;
    default:
      return reading.value.coasts ?? [];
  }
}

/**
 * One coast row: what orbit this stretch of the plan leaves the craft in.
 *
 * <p>The clause is inline and the numbers are behind a disclosure, which is the
 * split the question takes. "What orbit does this burn put me in" is answered by
 * five words; "and is it stable" needs the bands, and an operator asks the second
 * only after the first.</p>
 */
function CoastRow({
  coast,
  isFinal,
  viewUt,
}: {
  coast: PrincipiaCoastAnalysis;
  isFinal: boolean;
  viewUt: number | null;
}) {
  const index = magnitudeOf(coast.index);
  const starts = magnitudeOf(coast.startsAtUt);
  const ends = magnitudeOf(coast.endsAtUt);
  const duration = starts === null || ends === null ? null : ends - starts;
  const description =
    coast.analysis == null ? null : orbitDescription(coast.analysis);

  const name = isFinal
    ? "the final coast"
    : index === null
      ? "this coast"
      : `coast ${index + 1}`;

  const label = (
    <Cluster justify="start" gap="sm" wrap>
      <RowName>{isFinal ? "FINAL" : name.toUpperCase()}</RowName>
      {description === null ? (
        // An absence with a reason. A coast that follows a burn the integrator
        // could not compute has no valid initial state to analyse from, so the
        // producer has nothing to describe, and a blank row would read as a
        // coast in no particular orbit.
        <Text tone="faint" size="sm">
          {coast.analysis == null
            ? "no analysis for this coast"
            : "orbit not described"}
        </Text>
      ) : (
        <Badge severity="info">{description.toUpperCase()}</Badge>
      )}
      {duration !== null && (
        <Text tone="faint" size="sm">
          <Countdown value={duration} />
        </Text>
      )}
    </Cluster>
  );

  if (coast.analysis == null) {
    return <Row as="div">{label}</Row>;
  }

  return (
    <Disclosure
      variant="inline"
      /*
       * Grows in flow rather than scrolling its own content: the widget body it
       * sits in already scrolls, and a second scroller inside it hides the last
       * rows behind a bar a reader has no reason to look for.
       */
      panelHeight="auto"
      label={label}
      ariaLabel={`Show the mean elements of ${name}`}
    >
      <OrbitAnalysisRows orbit={coast.analysis} viewUt={viewUt} />
    </Disclosure>
  );
}

/**
 * What orbit each stretch of the flight plan leaves the craft in.
 *
 * <p><b>The half of the plan the burn list cannot show.</b> A burn row says how
 * much velocity is spent and when; it does not say what the craft ends up
 * flying, and that is usually the question. Principia works this out for every
 * coast of every plan already, inside its own recompute, and shows only a
 * phrase.</p>
 *
 * <p><b>These need no request and no open window.</b> The producer asks for a
 * coast analysis inside every flight-plan recompute, and a plan carried in from
 * a save is recomputed the first time anything opens it, so these exist for a
 * craft whose flight planner the player has never opened.</p>
 *
 * <p><b>They are current as of the last recompute, not as of now.</b> Each coast
 * is anchored at its own start, which is why every one of them is dated from an
 * instant rather than presented as live.</p>
 */
export function CoastAnalysisSection() {
  const coasts = coastsOf(useTelemetry("principia.analysis"));
  const viewUt = magnitudeOf(useViewUt());

  if (coasts === null) {
    return (
      <Section data-coast-analysis="">
        <SectionTitle>PLANNED ORBITS</SectionTitle>
        <Stack role="status" aria-live="polite">
          <Cluster justify="start">
            <Badge severity="caution">ANALYSIS NOT OBSERVED</Badge>
          </Cluster>
          <Text tone="faint" size="sm">
            No n-body analysis has reached this console for the active craft.
          </Text>
        </Stack>
      </Section>
    );
  }

  if (coasts.length === 0) {
    return (
      <Section data-coast-analysis="">
        <SectionTitle>PLANNED ORBITS</SectionTitle>
        {/* A positive observation of no plan, not silence about one. */}
        <Text tone="faint" size="sm">
          No flight plan, so no planned orbits.
        </Text>
      </Section>
    );
  }

  return (
    <Section data-coast-analysis="">
      <SectionTitle>PLANNED ORBITS</SectionTitle>
      <Stack gap="xs">
        {coasts.map((coast, position) => (
          <CoastRow
            key={magnitudeOf(coast.index) ?? position}
            coast={coast}
            /*
             * The last coast is the orbit the plan ENDS in, which is the one an
             * operator is usually asking about, so it is named rather than
             * numbered.
             */
            isFinal={position === coasts.length - 1 && coasts.length > 1}
            viewUt={viewUt}
          />
        ))}
      </Stack>
    </Section>
  );
}

registerAugment({
  id: "principia-coast-analysis",
  augments: "maneuver-planner.sections",
  component: CoastAnalysisSection,
  owner: PRINCIPIA,
});
