import type { ComponentProps, Reading } from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  useTelemetry,
  useViewUt,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Countdown,
  magnitudeOf,
  NULL_DISPLAY,
  Panel,
  PanelBody,
  PanelTitle,
  Row,
  RowName,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { PrincipiaProvenance } from "../__generated__/contract";
import { PRINCIPIA } from "../uplink";
import "../topics";

type ProvenanceConfig = Record<string, never>;

/**
 * The producer's frame kinds, by ordinal.
 *
 * <para>Named on THIS side, deliberately, and not because a string on the wire
 * would have been inconvenient. Every method the producer offers that would hand
 * over a formatted frame name reaches its fatal-log helper through a default
 * branch, and that aborts the KSP process. So the ordinal travels and the label
 * is ours.</para>
 *
 * <para>An unknown ordinal renders as the ordinal rather than as a guess. A new
 * frame kind in a later build should read as "frame 7", which is obviously
 * incomplete, instead of being rounded to whichever neighbour is closest.</para>
 */
const FRAME_NAMES: Readonly<Record<number, string>> = {
  0: "Body-centred non-rotating",
  1: "Barycentric rotating",
  2: "Body surface",
  3: "Rotating-pulsating",
  4: "Body-centred parent direction",
};

function frameLabel(
  ordinal: number | null,
  centreBody: string | undefined,
): string {
  if (ordinal === null) return NULL_DISPLAY;
  const kind = FRAME_NAMES[ordinal] ?? `Frame ${ordinal}`;
  return centreBody ? `${kind}, ${centreBody}` : kind;
}

/**
 * The settings themselves are current whenever they arrive, so a stale reading is
 * still the last thing that was true and worth showing. Only `pending`/`absent`
 * means nothing has come.
 */
function provenanceOf(
  reading: Reading<PrincipiaProvenance>,
): PrincipiaProvenance | undefined {
  switch (reading.state) {
    case "observed":
    case "stale":
    case "reckonable":
      return reading.value;
    default:
      return undefined;
  }
}

/**
 * The prediction accuracy bound: the pair of settings that decide whether any
 * propagated number on any other widget can be trusted.
 *
 * <para><b>This is the half the widget exists for.</b> A provenance panel showing
 * only the frame and the history length would be a provenance panel that omits
 * the provenance: those are context, and this is the yardstick.</para>
 *
 * <para>Which is exactly why it says UNOBSERVED rather than showing a number when
 * it has none. The producer recomputes both values inside its own settings UI, so
 * unobserved they sit at constructor defaults that resolve to a plausible
 * tolerance and a plausible step count. Printing those would hand an operator a
 * fabricated basis for judging everything else on screen, with nothing to
 * indicate it. A missing yardstick is a gap someone can act on; an invented one
 * is worse than no panel at all.</para>
 *
 * <para>Both halves are shown together because neither means much alone: a tight
 * tolerance with a low step limit is a prediction that stops early, not an
 * accurate one.</para>
 */
function PredictionBound({
  provenance,
  viewUt,
}: {
  provenance: PrincipiaProvenance;
  viewUt: number | null;
}) {
  const observedAtUt = magnitudeOf(provenance.predictionObservedAtUt);
  if (observedAtUt === null) {
    return (
      <Section data-prediction-bound="">
        <SectionTitle>PREDICTION ACCURACY</SectionTitle>
        <Stack role="status" aria-live="polite">
          {/* A `Badge` is a block child of a `Stack`, so it stretches to the full
              width and stops reading as a badge. A start-justified `Cluster`
              shrinks it back to its content. */}
          <Cluster justify="start">
            <Badge severity="caution">UNOBSERVED</Badge>
          </Cluster>
          {/* Muted: this is instructional, and at the default accent tone it was
              the loudest thing on a panel whose subject is the data around it. */}
          <Text tone="faint" size="sm">
            Open Principia's main window once to publish the prediction
            tolerance and step limit.
          </Text>
        </Stack>
      </Section>
    );
  }
  const age = viewUt === null ? null : viewUt - observedAtUt;
  return (
    <Section data-prediction-bound="">
      <SectionTitle>PREDICTION ACCURACY</SectionTitle>
      <Stack>
        {/* A label/value row each, not two captioned readouts side by side. The
            kit's `Row` is the dense settings shape: the name truncates on the
            left and the value stays pinned right, so a long frame name cannot
            push a value off the panel. Captioned readouts put the caption inline
            after the value, which read as "0.010 mTOLERANCE". */}
        <Row as="div">
          <RowName>Tolerance</RowName>
          {provenance.predictionToleranceMetres == null ? (
            <Text>{NULL_DISPLAY}</Text>
          ) : (
            <Unit value={provenance.predictionToleranceMetres} decimals={3} />
          )}
        </Row>
        <Row as="div">
          <RowName>Step limit</RowName>
          {provenance.predictionMaxSteps == null ? (
            <Text>{NULL_DISPLAY}</Text>
          ) : (
            <Unit value={provenance.predictionMaxSteps} decimals={0} />
          )}
        </Row>
        <Cluster wrap justify="start" gap="sm">
          {age === null || age <= 0 ? (
            <Badge severity="nominal">OBSERVED NOW</Badge>
          ) : (
            <Badge severity="caution">
              OBSERVED <Countdown value={age} /> AGO
            </Badge>
          )}
          {/* The bound is per vessel, so naming the craft it was read for is not
              decoration: an operator reading it as a global setting would trust
              the wrong number on every other craft in the fleet.

              Muted and small, because it is an attribution rather than a value.
              At the default tone and size it rendered as accent-green body text
              beside a small badge and read as the panel's heading, which put the
              most emphasis on the least important thing on the row. */}
          {provenance.predictionVesselId != null && (
            <Text tone="faint" size="xs">
              for {provenance.predictionVesselId}
            </Text>
          )}
        </Cluster>
      </Stack>
    </Section>
  );
}

/**
 * Propagation provenance: what is authoritative right now.
 *
 * <para><b>What the in-game surface cannot do: put these together.</b> Three
 * settings decide whether a propagated number can be trusted at a given instant,
 * and in-game they live in three different windows. An operator cannot hold three
 * windows on one screen on another machine, and would not think to check the
 * third.</para>
 *
 * <para>The patched-conics row is the trust question in reverse. With stock conics
 * also being drawn there are two curves on the map and only one is the integrated
 * one, so an operator needs to know which they are reading before anything else
 * here matters.</para>
 */
export function PropagationProvenanceComponent(
  _props: ComponentProps<ProvenanceConfig>,
) {
  const provenance = provenanceOf(useTelemetry("principia.provenance"));
  const viewUt = magnitudeOf(useViewUt());

  if (provenance === undefined) {
    return (
      <Panel>
        <PanelTitle>Propagation Provenance</PanelTitle>
        <PanelBody>
          <Stack role="status" aria-live="polite">
            <Cluster justify="start">
              <Badge severity="offline">NO N-BODY PROVIDER</Badge>
            </Cluster>
            <Text tone="faint" size="sm">
              Nothing is publishing propagation settings, so the trajectories on
              screen are the stock two-body ones.
            </Text>
          </Stack>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle>Propagation Provenance</PanelTitle>
      {/* `PanelBody` supplies the content inset and the scrolling. Without it a
          value pinned to the right of a `Row` runs to the panel's own edge and
          the last character is clipped, and content taller than the panel is
          simply cut instead of scrolling. Both were visible in the first
          renders. */}
      <PanelBody>
        <Stack>
          <PredictionBound provenance={provenance} viewUt={viewUt} />
          <Section>
            <SectionTitle>PLOTTING</SectionTitle>
            <Stack>
              <Row as="div">
                <RowName>Frame</RowName>
                <Text>
                  {frameLabel(
                    magnitudeOf(provenance.plottingFrameType),
                    provenance.plottingFrameCentreBody,
                  )}
                </Text>
              </Row>
              <Row as="div">
                <RowName>History kept</RowName>
                {provenance.historyLengthSeconds == null ? (
                  <Text>{NULL_DISPLAY}</Text>
                ) : (
                  <Countdown value={provenance.historyLengthSeconds} />
                )}
              </Row>
              {/* Wrapping, because three badges do not fit a narrow panel on one
                line and an unwrapped cluster clips the last one at the edge
                rather than dropping it. A clipped warning is worse than a
                stacked one. */}
              <Cluster wrap justify="start" gap="sm">
                {provenance.targetFrameSelected === true && (
                  <Badge severity="info">TARGET-RELATIVE FRAME</Badge>
                )}
                {provenance.displayPatchedConics === true && (
                  <Badge severity="warning">STOCK CONICS ALSO DRAWN</Badge>
                )}
                <HiddenMarkers provenance={provenance} />
              </Cluster>
            </Stack>
          </Section>
        </Stack>
      </PanelBody>
    </Panel>
  );
}

/**
 * Whether any plotting frame is hiding markers or celestials from the operator.
 *
 * <para>Shown only when something IS hidden. A count of zero is the ordinary case
 * and a row saying so would be noise on a panel whose value is that everything on
 * it matters.</para>
 */
function HiddenMarkers({ provenance }: { provenance: PrincipiaProvenance }) {
  const markers = magnitudeOf(provenance.framesHidingUnpinnedMarkers) ?? 0;
  const celestials =
    magnitudeOf(provenance.framesHidingUnpinnedCelestials) ?? 0;
  if (markers === 0 && celestials === 0) {
    return null;
  }
  return (
    <Badge severity="info">
      {markers > 0 && celestials > 0
        ? "SOME FRAMES HIDE MARKERS AND BODIES"
        : markers > 0
          ? "SOME FRAMES HIDE UNPINNED MARKERS"
          : "SOME FRAMES HIDE UNPINNED BODIES"}
    </Badge>
  );
}

registerComponent<ProvenanceConfig>({
  id: "propagation-provenance",
  name: "Propagation Provenance",
  description:
    "What is computing the trajectories, how accurately, and in which frame. The three settings that decide whether a propagated number can be trusted, on one surface.",
  tags: ["diagnostics", "trajectory"],
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 3, h: 4 },
  component: PropagationProvenanceComponent,
  channels: ["principia.provenance"],
  defaultConfig: {},
  actions: [],
  owner: PRINCIPIA,
});
