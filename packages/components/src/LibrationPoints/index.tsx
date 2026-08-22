import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import {
  buildElements,
  CELESTIAL_FACTS,
  type CelestialFacts,
  LIBRATION_DRIFTING_UNITS,
  LIBRATION_ON_STATION_UNITS,
  LIBRATION_REFUSALS,
  type LibrationAnswer,
  type LibrationOffset,
  type LibrationPair,
  lagrangePointsAt,
  librationOffsetOf,
  librationPairLabel,
  librationPairsOf,
  type OrbitElements,
  type OrbitTrajectory,
  type SystemInstant,
  solve,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  TrajectoryFrameKindLike,
  useOrbitTrajectory,
  useProcessor,
  useViewUt,
  type Vector3,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  Select,
} from "@ksp-gonogo/ui";
import {
  FramedDisplay,
  Row,
  RowName,
  Stack,
  Text,
  Unit,
  useModalSaveBar,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { quantiseUt } from "../MapView/predictionThrottle";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { LibrationDiagram } from "./LibrationDiagram";

/**
 * Libration points as PLACES: where a body pair's five of them are, and how far
 * off one of them a craft is.
 *
 * ## One control, because the pair IS the frame
 *
 * A libration point is a fixed location only in a frame co-rotating with a body
 * PAIR, and all five of one pair's points stand still in that pair's frame at
 * the same time. Kerbin-Mun's and Kerbol-Kerbin's cannot both stand still at
 * once, so the widget has exactly ONE choice in it: the pair. That choice is the
 * frame choice, there is no second picker anywhere here, and the two could not
 * be separated without offering a frame in which nothing this widget draws is
 * stationary.
 *
 * ## Why it does not live on the system diagram
 *
 * The system diagram plots in metres about a parent, which is right for
 * everything it draws. In metres a pair's separation breathes and the five
 * markers walk in and out once per orbit, and a marker that walks is not a
 * libration point. This diagram is in the pair's own units, so they do not.
 */

interface LibrationPointsConfig {
  /**
   * Which pair, by the SECONDARY body's name: the pair is `<that body's
   * parent>-<that body>`, which is the way every libration pair is written and
   * the way the arithmetic is parameterised.
   *
   * `"auto"` follows the craft: the pair whose points it is nearest to, measured
   * as a fraction of that pair's own separation so the comparison is between
   * like and like. Absent means `"auto"`.
   */
  pair?: string;
}

const AUTO_PAIR = "auto";

/** Bucket the view instant so the points recompute about once a second, not once a render. */
const UT_BUCKET_SECONDS = 1;

interface Resolved {
  answer: LibrationAnswer;
  offset: LibrationOffset | null;
}

/**
 * The craft's root-centred inertial position, or null when it cannot be placed.
 *
 * Solved from the streamed elements about the body they are measured against,
 * then added to that body's own root-centred position, which is the same
 * catalogue solve the frame itself is built on. Doing it any other way would
 * place the craft in a frame the markers are not in.
 */
function vesselInertialAt(
  elements: OrbitElements | null,
  referenceBodyIndex: number | null | undefined,
  system: SystemInstant,
): Vector3 | null {
  if (elements === null || referenceBodyIndex == null) return null;
  if (!(elements.ecc >= 0 && elements.ecc < 1)) return null;
  const parent = system.positionByIndex.get(referenceBodyIndex);
  if (parent === undefined) return null;
  const state = solve(elements, system.ut);
  return [
    parent[0] + state.position[0],
    parent[1] + state.position[1],
    parent[2] + state.position[2],
  ];
}

function resolveFor(
  facts: CelestialFacts | undefined,
  secondaryIndex: number | null,
  ut: number,
  system: SystemInstant | null,
  vesselInertial: Vector3 | null,
): Resolved {
  const answer = lagrangePointsAt(
    facts,
    secondaryIndex,
    ut,
    system ?? undefined,
  );
  return { answer, offset: librationOffsetOf(answer, vesselInertial) };
}

/**
 * The pair `"auto"` picks: whichever one the craft is nearest to, as a fraction
 * of that pair's own separation.
 *
 * Compared in frame units rather than metres deliberately. In metres the pair
 * with the widest separation would win almost everywhere, and "nearest" would
 * mean "biggest", which is not a question anyone asked.
 *
 * With no craft to go by it falls back to the craft's own body if that body can
 * be half of a pair, then to the first pair the catalogue offers, so the widget
 * has something real to draw before a vessel arrives.
 */
function autoPair(
  facts: CelestialFacts | undefined,
  candidates: readonly LibrationPair[],
  ut: number,
  system: SystemInstant | null,
  vesselInertial: Vector3 | null,
  vesselBodyIndex: number | null | undefined,
): number | null {
  if (candidates.length === 0) return null;
  if (vesselInertial !== null && system !== null) {
    let best: { index: number; units: number } | null = null;
    for (const pair of candidates) {
      const { offset } = resolveFor(
        facts,
        pair.secondaryIndex,
        ut,
        system,
        vesselInertial,
      );
      if (offset === null) continue;
      if (best === null || offset.distanceUnits < best.units) {
        best = { index: pair.secondaryIndex, units: offset.distanceUnits };
      }
    }
    if (best !== null) return best.index;
  }
  const own = candidates.find((p) => p.secondaryIndex === vesselBodyIndex);
  return own?.secondaryIndex ?? candidates[0].secondaryIndex;
}

/** The sentence a refusal shows instead of a diagram. */
function refusalCopy(answer: LibrationAnswer): string {
  if (answer.refusal === LIBRATION_REFUSALS.NotAttempted) {
    return "No pair chosen yet, so no libration points have been sought. Pick one above.";
  }
  return answer.because;
}

const KEEPING_TONE = {
  "on-station": "go",
  drifting: "warn",
  elsewhere: "muted",
} as const;

const KEEPING_WORDS = {
  "on-station": "holding station",
  drifting: "drifting off station",
  elsewhere: "not stationkeeping on it",
} as const;

function LibrationPointsComponent({
  config,
  id,
}: Readonly<ComponentProps<LibrationPointsConfig>>) {
  const facts = useProcessor(CELESTIAL_FACTS);
  const viewUt = useViewUt()?.magnitude;
  const ut = quantiseUt(
    typeof viewUt === "number" ? viewUt : undefined,
    UT_BUCKET_SECONDS,
  );

  // The craft's dot is a positive claim about where it is, so the elements come
  // from a current reading or from a model that offers one, and otherwise from
  // nothing: the diagram simply draws no craft.
  const orbitReading = useTelemetry("vessel.orbit");
  const orbit =
    orbitReading.state === "observed"
      ? orbitReading.value
      : orbitReading.state === "reckonable"
        ? orbitReading.reckoned.value
        : undefined;
  const identityReading = useTelemetry("vessel.identity");
  const identity =
    identityReading.state === "observed" || identityReading.state === "stale"
      ? identityReading.value
      : undefined;

  const candidates = useMemo(() => librationPairsOf(facts), [facts]);

  // The ONE control. Its value is the pair, and the pair is the frame: there is
  // deliberately no second picker for the frame, because a frame chosen apart
  // from the pair is one in which none of these five markers stands still. The
  // saved config seeds it and an operator can switch it live without editing a
  // dashboard.
  const [chosen, setChosen] = useState<string>(config?.pair ?? AUTO_PAIR);
  const chosenIndex =
    chosen === AUTO_PAIR ? null : (facts?.indexByName[chosen] ?? null);
  const chosenIsMissing = chosen !== AUTO_PAIR && chosenIndex === null;

  const system = useMemo(
    () =>
      facts === undefined || ut == null ? null : systemInstantAt(facts, ut),
    [facts, ut],
  );

  // Through the SDK's own wire-to-radians conversion, which is the one place
  // the degree/radian mix on `vessel.orbit` is normalised. A second copy here
  // would be a second chance to get the `meanAnomalyAtEpoch` quirk wrong.
  const elements = useMemo<OrbitElements | null>(
    () => (orbit?.sma.isFinite() ? buildElements(orbit) : null),
    [orbit],
  );

  const vesselInertial = useMemo(
    () =>
      system === null
        ? null
        : vesselInertialAt(elements, orbit?.referenceBodyIndex, system),
    [elements, orbit?.referenceBodyIndex, system],
  );

  const secondaryIndex = useMemo(() => {
    if (chosen !== AUTO_PAIR) return chosenIndex;
    if (ut == null) return null;
    return autoPair(
      facts,
      candidates,
      ut,
      system,
      vesselInertial,
      identity?.parentBodyIndex,
    );
  }, [
    chosen,
    chosenIndex,
    facts,
    candidates,
    ut,
    system,
    vesselInertial,
    identity?.parentBodyIndex,
  ]);

  const { answer, offset } = useMemo(
    () =>
      resolveFor(
        facts,
        secondaryIndex,
        ut ?? Number.NaN,
        system,
        vesselInertial,
      ),
    [facts, secondaryIndex, ut, system, vesselInertial],
  );

  const drawn = answer.refusal === LIBRATION_REFUSALS.NotRefused;

  // The craft's own path, asked for IN THIS FRAME. The seam samples a conic
  // answer rather than handing back the instruction to draw an ellipse, because
  // an ellipse is a shape in the orbit's own plane and a rosette in this one, so
  // the curve is live on an ordinary install rather than only where something
  // integrates.
  const readFrame = useMemo(
    () =>
      facts !== undefined && drawn
        ? { readFrame: { choice: answer.frameChoice, facts } }
        : undefined,
    [facts, drawn, answer.frameChoice],
  );
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(
    orbit,
    readFrame,
  );
  const trajectoryWithheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;
  const secondaryBody =
    answer.pair === null
      ? null
      : (facts?.bodies.find((b) => b.index === answer.pair?.secondaryIndex) ??
        null);
  const primaryBody =
    answer.pair?.primaryIndex == null
      ? null
      : (facts?.bodies.find((b) => b.index === answer.pair?.primaryIndex) ??
        null);

  return (
    <Panel
      panelTitle="LIBRATION"
      panelToolbar={
        <div style={PAIR_LABEL}>
          {/* Scoped to the widget instance: a dashboard can hold two of these
              and two controls sharing one id would leave the label pointing at
              whichever mounted first. */}
          <label htmlFor={`${id}-libration-pair`} style={PAIR_LABEL_TEXT}>
            Pair
          </label>
          <Select
            id={`${id}-libration-pair`}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value={AUTO_PAIR}>Auto (nearest to the craft)</option>
            {candidates.map((pair) => (
              <option
                key={pair.secondaryIndex}
                value={pair.secondaryName ?? ""}
              >
                {librationPairLabel(pair)}
              </option>
            ))}
            {chosenIsMissing && (
              // The saved pair is still the choice even when this save has no
              // such body: dropping it silently would make the control show a
              // pair the widget is not drawing.
              <option value={chosen}>{chosen} (not in this system)</option>
            )}
          </Select>
        </div>
      }
    >
      <TrajectoryFrameCaption
        frame={{
          kind: TrajectoryFrameKindLike.RotatingPulsating,
          primaryBodyIndex: answer.pair?.primaryIndex ?? undefined,
          secondaryBodyIndex: answer.pair?.secondaryIndex,
          lengthsPulsate: true,
          scaleConvention:
            TRAJECTORY_SCALE_CONVENTIONS.separationAtPointInstant,
          unitLength: answer.frame?.unitLength,
        }}
      />
      {/* Beside the frame caption rather than over the picture: the five points
          are still where they are and only the craft's own curve is missing, so
          covering the diagram would overstate what was refused. */}
      {drawn && trajectoryWithheld && (
        <TrajectoryWithheldNote withheld={trajectoryWithheld} compact />
      )}
      {!drawn ? (
        <div style={REFUSAL} role="status" aria-live="polite">
          <Text tone="muted" size="sm">
            {refusalCopy(answer)}
          </Text>
        </div>
      ) : (
        <>
          <FramedDisplay style={DIAGRAM_FRAME}>
            <LibrationDiagram
              answer={answer}
              offset={offset}
              primaryRadius={primaryBody?.radius ?? null}
              secondaryRadius={secondaryBody?.radius ?? null}
              vesselName={
                typeof identity?.name === "string" ? identity.name : null
              }
              trajectory={trajectory}
            />
          </FramedDisplay>
          <Stack gap="xs" as="ul" style={READOUTS}>
            <Row>
              <RowName>Separation</RowName>
              <Text>
                <Unit value={value("m", answer.frame?.unitLength ?? 0)} />
              </Text>
            </Row>
            <Row>
              <RowName>Mass ratio</RowName>
              <Text>
                {/* The only parameter the five positions depend on, so it is
                    worth showing: the same ratio always puts them in the same
                    place, whatever the pair. */}
                <Unit value={value("%", answer.massRatio * 100)} decimals={3} />
              </Text>
            </Row>
            {offset === null ? (
              <Row>
                <RowName>Craft</RowName>
                <Text tone="muted">not placeable in this frame</Text>
              </Row>
            ) : (
              <>
                <Row>
                  <RowName>Nearest</RowName>
                  <Text tone={KEEPING_TONE[offset.keeping]}>
                    {offset.nearest} · {KEEPING_WORDS[offset.keeping]}
                  </Text>
                </Row>
                <Row>
                  <RowName>Off station</RowName>
                  <Text tone={KEEPING_TONE[offset.keeping]}>
                    <Unit value={value("m", offset.distanceMetres)} />
                  </Text>
                </Row>
              </>
            )}
          </Stack>
        </>
      )}
    </Panel>
  );
}

function LibrationPointsConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<LibrationPointsConfig>>) {
  const facts = useProcessor(CELESTIAL_FACTS);
  const candidates = useMemo(() => librationPairsOf(facts), [facts]);
  const [pair, setPair] = useState(config?.pair ?? AUTO_PAIR);
  const candidate = useMemo<LibrationPointsConfig>(() => ({ pair }), [pair]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="libration-pair">Body pair</FieldLabel>
        <Select
          id="libration-pair"
          value={pair}
          onChange={(e) => setPair(e.target.value)}
        >
          <option value={AUTO_PAIR}>Auto (nearest to the craft)</option>
          {candidates.map((p) => (
            <option key={p.secondaryIndex} value={p.secondaryName ?? ""}>
              {librationPairLabel(p)}
            </option>
          ))}
        </Select>
        <FieldHint>
          The pair is also the frame. Five libration points stand still only in
          the frame that turns with the two bodies they belong to, so choosing
          the pair is choosing what the picture holds still, and there is
          nothing else to choose. "Auto" follows the craft to whichever pair it
          is nearest to.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

const PAIR_LABEL: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-4)",
};

const PAIR_LABEL_TEXT: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.05em",
};

const DIAGRAM_FRAME: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0 };

const READOUTS: CSSProperties = { flex: "0 0 auto", listStyle: "none" };

const REFUSAL: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "var(--space-8)",
};

registerComponent<LibrationPointsConfig>({
  id: "libration-points",
  name: "Libration Points",
  description:
    "The five libration points of a body pair, drawn in the frame that turns with it so they hold still, with the craft's offset from the one it is nearest.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 6, h: 10 },
  minSize: { w: 4, h: 7 },
  component: LibrationPointsComponent,
  configComponent: LibrationPointsConfigComponent,
  dataRequirements: ["system.bodies"],
  optionalChannels: ["vessel.orbit", "vessel.identity"],
  defaultConfig: { pair: AUTO_PAIR },
  actions: [],
  pushable: true,
});

export { LibrationDiagram } from "./LibrationDiagram";
export {
  LIBRATION_DRIFTING_UNITS,
  LIBRATION_ON_STATION_UNITS,
  LibrationPointsComponent,
};
