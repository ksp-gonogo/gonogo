import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
} from "@ksp-gonogo/core";
import {
  buildElements,
  CELESTIAL_FACTS,
  type CelestialFacts,
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
  Section,
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

const topics = defineTopicManifest({
  channels: ["system.bodies"],
  optionalChannels: ["vessel.orbit", "vessel.identity"],
});

/**
 * Libration points as places: where a body pair's five are, and how far off
 * one of them a craft is. A libration point stands still only in a frame
 * co-rotating with its pair, so the pair is the frame and the widget's one
 * control. It is drawn in the pair's own units rather than on the metric
 * system diagram, where the markers would walk in and out once per orbit.
 */

interface LibrationPointsConfig {
  /**
   * Which pair, by the secondary body's name (`<parent>-<body>`). `"auto"`,
   * or absent, follows the craft: the pair it is nearest to as a fraction of
   * that pair's own separation.
   */
  pair?: string;
}

const AUTO_PAIR = "auto";

const librationPointsActions = [
  {
    id: "cyclePair",
    label: "Cycle Pair",
    accepts: ["button"],
    description: "Step to the next body pair, with Auto in the cycle.",
  },
] as const satisfies readonly ActionDefinition[];

export type LibrationPointsActions = typeof librationPointsActions;

/** Bucket the view instant so the points recompute about once a second, not once a render. */
const UT_BUCKET_SECONDS = 1;

interface Resolved {
  answer: LibrationAnswer;
  offset: LibrationOffset | null;
}

/**
 * The craft's root-centred inertial position, or null when it cannot be
 * placed: its elements solved about their body, plus that body's own position
 * from the same catalogue solve the frame is built on.
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
 * The pair `"auto"` picks: the nearest as a fraction of each pair's own
 * separation, since in metres the widest pair would win almost everywhere.
 * With no craft, the craft's own body if it can be half of a pair, then the
 * catalogue's first pair.
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
  /* A catalogue does not decay down a link, so a held one is still the catalogue. */
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "stale"
      ? factsReading.value
      : undefined;
  const viewUt = useViewUt()?.magnitude;
  const ut = quantiseUt(
    typeof viewUt === "number" ? viewUt : undefined,
    UT_BUCKET_SECONDS,
  );

  // The craft's dot is a claim about now: a current reading or a model, else no craft.
  const orbitReading = topics.useTelemetry("vessel.orbit");
  /* The observation overlaid by what the conic moved (the phase). `reckoning.value` alone is not an orbit. */
  const orbitObserved =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbit =
    orbitObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
        ? { ...orbitObserved, ...orbitReading.reckoning.value }
        : orbitObserved;
  const identityReading = topics.useTelemetry("vessel.identity");
  const identity =
    identityReading.state === "observed" || identityReading.state === "stale"
      ? identityReading.value
      : undefined;

  const candidates = useMemo(() => librationPairsOf(facts), [facts]);

  // The one control: the pair is the frame. Seeded from config, switchable live.
  const [chosen, setChosen] = useState<string>(config?.pair ?? AUTO_PAIR);
  const chosenIndex =
    chosen === AUTO_PAIR ? null : (facts?.indexByName[chosen] ?? null);
  const chosenIsMissing = chosen !== AUTO_PAIR && chosenIndex === null;

  useActionInput<LibrationPointsActions>({
    cyclePair: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const order = [
        AUTO_PAIR,
        ...candidates.flatMap((pair) =>
          pair.secondaryName ? [pair.secondaryName] : [],
        ),
      ];
      const next = order[(order.indexOf(chosen) + 1) % order.length];
      setChosen(next);
      return { pair: next };
    },
  });

  const system = useMemo(
    () =>
      facts === undefined || ut == null ? null : systemInstantAt(facts, ut),
    [facts, ut],
  );

  // The SDK's conversion is the one place `vessel.orbit`'s degree/radian mix is normalised.
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

  // The craft's path sampled in this frame: an ellipse in the orbit's plane is a rosette in this one.
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
          {/* Scoped to the instance so two of these widgets never share a control id. */}
          <label htmlFor={`${id}-libration-pair`} style={PAIR_LABEL_TEXT}>
            Pair
          </label>
          <Select
            id={`${id}-libration-pair`}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            {/* The short form: the toolbar shares its row with the label, and the caption names the resolved pair. */}
            <option value={AUTO_PAIR}>Auto</option>
            {candidates.map((pair) => (
              <option
                key={pair.secondaryIndex}
                value={pair.secondaryName ?? ""}
              >
                {librationPairLabel(pair)}
              </option>
            ))}
            {chosenIsMissing && (
              // The saved pair stays the choice when this save has no such body, so the control never shows a pair not being drawn.
              <option value={chosen}>{chosen} (not in this system)</option>
            )}
          </Select>
        </div>
      }
      sections={[
        <Section key="frame" full>
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
          {/* Beside the caption, not over the picture: only the craft's curve is refused. */}
          {drawn && trajectoryWithheld && (
            <TrajectoryWithheldNote withheld={trajectoryWithheld} compact />
          )}
        </Section>,
        <Section key="view" fill>
          {!drawn ? (
            <div style={REFUSAL} role="status" aria-live="polite">
              <Text tone="muted" size="sm">
                {refusalCopy(answer)}
              </Text>
            </div>
          ) : (
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
          )}
        </Section>,
        drawn ? (
          <Section key="readouts" as="ul" gap="rows" style={READOUTS}>
            <Row>
              <RowName>Separation</RowName>
              <Text>
                <Unit value={value("m", answer.frame?.unitLength ?? 0)} />
              </Text>
            </Row>
            <Row>
              <RowName>Mass ratio</RowName>
              <Text>
                {/* The only parameter the five positions depend on. */}
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
          </Section>
        ) : null,
      ]}
    />
  );
}

function LibrationPointsConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<LibrationPointsConfig>>) {
  /* A catalogue does not decay down a link, so a held one is still the catalogue. */
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "stale"
      ? factsReading.value
      : undefined;
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
  gap: "var(--gap-related)",
};

const PAIR_LABEL_TEXT: CSSProperties = {
  fontSize: "var(--font-size-caption)",
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
  padding: "var(--inset-refusal)",
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
  channels: topics.channels,
  optionalChannels: topics.optionalChannels,
  defaultConfig: { pair: AUTO_PAIR },
  actions: librationPointsActions,
  pushable: true,
});

export { LibrationDiagram } from "./LibrationDiagram";
export { LibrationPointsComponent };
