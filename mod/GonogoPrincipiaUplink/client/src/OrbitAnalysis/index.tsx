import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerAugment,
  useTelemetry,
  useViewUt,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Band,
  Cluster,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type {
  PrincipiaAnalysis,
  PrincipiaOrbitAnalysis,
} from "../__generated__/contract";
import { orbitDescription, UNREACHABLE_ADJECTIVES } from "../orbitDescription";
import { PRINCIPIA } from "../uplink";
// Side-effect import: hydrates this Topic's units at decode time. Without it
// every band arrives as a bare number while the type still says it carries one.
import "../topics";

/**
 * The producer's own analysis, or the reason there is none.
 *
 * <p>Three absences, and they mean different things to an operator, so they do
 * not collapse. `unobserved` is the stream: nothing has arrived for this craft.
 * `notAnalysing` is the producer: it knows the craft and is running no analysis
 * of it, which is the ordinary state while its own window is shut. Only the
 * third carries numbers.</p>
 */
type AnalysisView =
  | { kind: "unobserved" }
  | { kind: "notAnalysing" }
  | { kind: "analysed"; orbit: PrincipiaOrbitAnalysis };

function analysisView(reading: Reading<PrincipiaAnalysis>): AnalysisView {
  switch (reading.state) {
    case "pending":
    case "absent":
    case "unowned":
      return { kind: "unobserved" };
    default: {
      const orbit = reading.value.orbit;
      return orbit == null
        ? { kind: "notAnalysing" }
        : { kind: "analysed", orbit };
    }
  }
}

/**
 * How old the elements are, and the honest answer when that is unknowable.
 *
 * <p>The producer publishes no instant for a vessel's own analysis: it is
 * anchored wherever the craft's history ended when the analyser was last asked
 * to run, and nothing on the payload carries that. So the age is a real number
 * for a coast and genuinely absent here, and the absence gets said outright
 * rather than left as a zero.</p>
 *
 * <p>Which is the point of the line. Mean elements look exactly as confident
 * when they are an hour old, and the producer keeps the last completed analysis
 * indefinitely once its window closes.</p>
 *
 * <p>Text rather than a badge, and that is the size talking: a badge does not
 * wrap, and the host widget declares itself usable at a hundred and twelve
 * pixels wide, which is narrower than any of these four phrases. A clipped
 * qualifier is worse than a wrapped one.</p>
 */
function AgeLine({
  epochUt,
  viewUt,
}: {
  epochUt: number | null;
  viewUt: number | null;
}) {
  if (epochUt === null || viewUt === null) {
    return (
      <Text tone="warn" size="sm">
        Elements of unknown age
      </Text>
    );
  }
  const age = viewUt - epochUt;
  if (age === 0) {
    return (
      <Text tone="go" size="sm">
        Measured from now
      </Text>
    );
  }
  if (age < 0) {
    // A coast that has not started yet. Not stale, and not current either: these
    // elements describe an orbit the craft is not in, which is the whole point
    // of a planned coast and exactly the thing an unlabelled band would blur.
    return (
      <Text tone="info" size="sm">
        Measured from <Countdown value={-age} /> ahead
      </Text>
    );
  }
  return (
    <Text tone="warn" size="sm">
      Measured from <Countdown value={age} /> ago
    </Text>
  );
}

/**
 * One analysis, as rows.
 *
 * <p>Exported so a coast can be rendered with the same body as the current
 * orbit. They are the same object and an operator comparing "the orbit I am in"
 * with "the orbit this burn puts me in" should be reading the same rows in the
 * same order.</p>
 */
export function OrbitAnalysisRows({
  orbit,
  viewUt,
}: {
  orbit: PrincipiaOrbitAnalysis;
  viewUt: number | null;
}) {
  if (orbit.elementsPresent !== true) {
    return (
      <Stack>
        <Text tone="warn" size="sm">
          Elements not determined
        </Text>
        <AgeLine epochUt={magnitudeOf(orbit.elementsEpochUt)} viewUt={viewUt} />
        {/* The interesting cause, and the one an operator can act on: the
            analysis integrates forward from the craft's present state, and it
            refuses a span shorter than one revolution. Waiting fixes it; looking
            for a fault does not. */}
        <Text tone="faint" size="sm">
          {orbit.gravitationallyBound === false
            ? "This trajectory is bound to nothing over the analysed span."
            : "The analysed span does not yet cover one full revolution."}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack>
      {/* The age and the window lead the numbers rather than sitting in the
          section header, because they qualify the numbers and the numbers are
          shown in two places: here under the current orbit, and again inside a
          coast row of the flight plan. A qualifier left in one header is a
          qualifier the other surface silently drops. */}
      <AgeLine epochUt={magnitudeOf(orbit.elementsEpochUt)} viewUt={viewUt} />
      {orbit.gravitationallyBound === false && (
        <Text tone="warn" size="sm">
          Not gravitationally bound
        </Text>
      )}
      {/* The window every band below belongs to. A band without it is
          meaningless: widening the span widens every interval and can flip every
          adjective in the description. */}
      <Row as="div">
        <RowName>OVER</RowName>
        {orbit.missionDurationSeconds == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <Countdown value={orbit.missionDurationSeconds} />
        )}
      </Row>
      {/* Three periods, each with its offset from the first. The whole content
          of this group is that they DIFFER, and on a low orbit they differ by
          seconds, which a two-tier duration renders as the same "1h 30min"
          three times over. The offset is the number that survives that. */}
      <PeriodRow name="SIDEREAL" seconds={orbit.siderealPeriodSeconds} />
      {/* The one an operator planning a node crossing needs specifically. */}
      <PeriodRow
        name="NODAL"
        seconds={orbit.nodalPeriodSeconds}
        relativeTo={orbit.siderealPeriodSeconds}
      />
      <PeriodRow
        name="ANOMALISTIC"
        seconds={orbit.anomalisticPeriodSeconds}
        relativeTo={orbit.siderealPeriodSeconds}
      />
      <Row as="div">
        <RowName>NODE DRIFT</RowName>
        {orbit.nodalPrecessionDegreesPerHour == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          // Four decimals, because two would print a fifth of a degree an hour
          // and a near-polar orbit's much smaller drift as the same number, and
          // "does this orbit precess" is the question the row answers.
          <Unit value={orbit.nodalPrecessionDegreesPerHour} decimals={4} />
        )}
      </Row>

      <Row as="div">
        <RowName>SMA</RowName>
        <Band
          min={orbit.meanSemimajorAxisMetres?.min}
          max={orbit.meanSemimajorAxisMetres?.max}
        />
      </Row>
      <Row as="div">
        <RowName>ECC</RowName>
        <Band
          min={orbit.meanEccentricity?.min}
          max={orbit.meanEccentricity?.max}
          decimals={4}
        />
      </Row>
      <Row as="div">
        <RowName>INC</RowName>
        <Band
          min={orbit.meanInclinationDegrees?.min}
          max={orbit.meanInclinationDegrees?.max}
          wrapsAt={360}
        />
      </Row>
      <Row as="div">
        <RowName>LAN</RowName>
        <Band
          min={orbit.meanLongitudeOfAscendingNodeDegrees?.min}
          max={orbit.meanLongitudeOfAscendingNodeDegrees?.max}
          wrapsAt={360}
        />
      </Row>
      <Row as="div">
        <RowName>ARG PE</RowName>
        <Band
          min={orbit.meanArgumentOfPeriapsisDegrees?.min}
          max={orbit.meanArgumentOfPeriapsisDegrees?.max}
          wrapsAt={360}
        />
      </Row>
      <Row as="div">
        <RowName>PE</RowName>
        <Band
          min={orbit.meanPeriapsisAltitudeMetres?.min}
          max={orbit.meanPeriapsisAltitudeMetres?.max}
        />
      </Row>
      <Row as="div">
        <RowName>AP</RowName>
        <Band
          min={orbit.meanApoapsisAltitudeMetres?.min}
          max={orbit.meanApoapsisAltitudeMetres?.max}
        />
      </Row>
      {/* A different claim from the periapsis band above, and the one a safety
          check reads: the closest the craft ever comes to the surface over the
          whole window, from the integrated trajectory rather than a filtered
          average of it. */}
      <Row as="div">
        <RowName>LOWEST</RowName>
        {orbit.lowestAltitudeMetres == null ? (
          <Text>{NULL_DISPLAY}</Text>
        ) : (
          <Unit value={orbit.lowestAltitudeMetres} />
        )}
      </Row>

      <HazardRow
        label="COLLISION"
        ut={orbit.firstCollisionUt}
        viewUt={viewUt}
        severity="critical"
      />
      <HazardRow
        label="COLLISION RISK"
        ut={orbit.firstCollisionRiskUt}
        viewUt={viewUt}
        severity="warning"
      />
      <HazardRow
        label="REENTRY"
        ut={orbit.firstReentryUt}
        viewUt={viewUt}
        severity="warning"
      />
    </Stack>
  );
}

/**
 * One of the three periods, with the offset that keeps it apart from the first.
 *
 * <p>A duration renderer shows two tiers, so three periods a few seconds apart
 * all print as the same "1h 30min". The offset is a duration of seconds and
 * renders as one, so the row says both the period and the thing the row exists
 * to show.</p>
 */
function PeriodRow({
  name,
  seconds,
  relativeTo,
}: {
  name: string;
  seconds: PrincipiaOrbitAnalysis["siderealPeriodSeconds"];
  relativeTo?: PrincipiaOrbitAnalysis["siderealPeriodSeconds"];
}) {
  const own = magnitudeOf(seconds);
  const reference = magnitudeOf(relativeTo);
  const offset = own === null || reference === null ? null : own - reference;
  return (
    <Row as="div">
      <RowName>{name}</RowName>
      {seconds == null ? (
        <Text>{NULL_DISPLAY}</Text>
      ) : (
        <Cluster justify="end" gap="sm">
          <Countdown value={seconds} />
          {offset !== null && offset !== 0 && (
            <Text tone="faint" size="sm">
              {offset > 0 ? "+" : "−"}
              <Countdown value={Math.abs(offset)} />
            </Text>
          )}
        </Cluster>
      )}
    </Row>
  );
}

/**
 * A hazard the analysis found, and nothing at all when it found none.
 *
 * <p>Absent rather than a dash, deliberately, and this is the one row where that
 * is right. The others answer a question the operator asked; these three are
 * warnings, and a permanent COLLISION row with nothing in it teaches an eye to skip the line
 * that will one day carry a countdown.</p>
 */
function HazardRow({
  label,
  ut,
  viewUt,
  severity,
}: {
  label: string;
  ut: PrincipiaOrbitAnalysis["firstCollisionUt"];
  viewUt: number | null;
  severity: "critical" | "warning";
}) {
  const instant = magnitudeOf(ut);
  if (instant === null || viewUt === null) {
    return null;
  }
  return (
    <Row as="div">
      <RowName>{label}</RowName>
      <Cluster justify="end" gap="sm">
        <Countdown value={instant - viewUt} clock />
        <Badge severity={severity}>{label}</Badge>
      </Cluster>
    </Row>
  );
}

/**
 * Principia's n-body orbit analysis, mirrored onto the widget that already
 * answers "what orbit is this".
 *
 * <p><b>What the stock widget beside it cannot say.</b> Every element above it
 * is a two-body osculating element: true at this instant and untrue a
 * revolution later on an oblate body. These are MEAN elements over an analysed
 * span, each a range whose width is how much the orbit wanders, and the node
 * drift is the secular rate that makes the three periods differ. Nothing outside
 * the producer computes them, which is why this reads its analysis rather than
 * deriving one.</p>
 *
 * <p><b>And it is a reading with an age.</b> The producer keeps the last
 * completed analysis indefinitely once its own window shuts, and mean elements
 * look no less confident for being an hour old. The badge is the first thing in
 * the section for that reason.</p>
 */
export function OrbitAnalysisSection() {
  const view = analysisView(useTelemetry("principia.analysis"));
  const viewUt = magnitudeOf(useViewUt());

  if (view.kind === "unobserved") {
    return (
      <Section data-orbit-analysis="">
        <SectionTitle>N-BODY ORBIT ANALYSIS</SectionTitle>
        <Stack role="status" aria-live="polite">
          <Text tone="warn" size="sm">
            Analysis not observed
          </Text>
          <Text tone="faint" size="sm">
            No n-body analysis has reached this console for the active craft.
          </Text>
        </Stack>
      </Section>
    );
  }

  if (view.kind === "notAnalysing") {
    return (
      <Section data-orbit-analysis="">
        <SectionTitle>N-BODY ORBIT ANALYSIS</SectionTitle>
        <Stack role="status" aria-live="polite">
          <Text tone="warn" size="sm">
            Not being analysed
          </Text>
          {/* A positive observation, not silence: Principia knows this craft and
              is running no analysis of it. It starts one while its own main
              window is open and destroys it outright when asked to analyse a
              different craft, so this is the ordinary state rather than a
              fault, and saying which is what stops an operator hunting one. */}
          <Text tone="faint" size="sm">
            Principia analyses one craft at a time, while its own window is
            open. Open it on this craft and the elements will appear here.
          </Text>
        </Stack>
      </Section>
    );
  }

  const { orbit } = view;
  const description = orbitDescription(orbit);

  return (
    <Section data-orbit-analysis="">
      <SectionTitle>N-BODY ORBIT ANALYSIS</SectionTitle>
      <Stack>
        {/* The producer's own window puts this phrase in its TITLE bar, and a
            line of text is what it is. A badge would not wrap, and "circular
            polar retrograde Kerbin orbit" is wider than this widget's declared
            minimum whatever the font. */}
        {description !== null && (
          <Text tone="info" weight="semibold">
            {description}
          </Text>
        )}

        <OrbitAnalysisRows orbit={orbit} viewUt={viewUt} />

        {/* Named rather than left to inference, so an operator who knows the
            word is missing will not read its absence as a claim.

            This used to name four adjectives and blame a ground-track
            recurrence. Three of them are said now: the recurrence was always
            arriving, and the equatorial crossings it derives are what decide
            them. The one left is missing for an unrelated reason, recorded on
            UNREACHABLE_ADJECTIVES.

            Only beside a phrase, though: with no elements there is no phrase for
            it to qualify, and a caveat about words nobody wrote is noise. */}
        {description !== null && (
          <Text tone="faint" size="sm">
            {`Cannot say ${UNREACHABLE_ADJECTIVES.join(", ")}: that needs the solar times of the nodes, which Gonogo does not carry.`}
          </Text>
        )}
      </Stack>
    </Section>
  );
}

registerAugment({
  id: "principia-orbit-analysis",
  augments: "current-orbit.sections",
  component: OrbitAnalysisSection,
  owner: PRINCIPIA,
});
