import type { ComponentProps } from "@ksp-gonogo/core";
import { useActionInput } from "@ksp-gonogo/core";
import {
  buildElements,
  LIBRATION_REFUSALS,
  type LibrationAnswer,
  librationPairLabel,
  librationPairsOf,
  type OrbitElements,
  type OrbitTrajectory,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  TrajectoryFrameKindLike,
  useOrbitTrajectory,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { Panel, Select } from "@ksp-gonogo/ui";
import { FieldLabel, FramedDisplay, Section, Text } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { quantiseUt } from "../MapView/predictionThrottle";
import type { HeldSince } from "../shared/heldFigure";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import {
  AUTO_PAIR,
  type LibrationPointsActions,
  type LibrationPointsConfig,
} from "./config";
import { LibrationDiagram } from "./LibrationDiagram";
import { LibrationReadouts } from "./LibrationReadouts";
import { autoPair, resolveFor, vesselInertialAt } from "./pairResolution";
import { librationPointsTopics } from "./topics";
import { useCatalogue } from "./useCatalogue";

/** Bucket the view instant so the points recompute about once a second, not once a render. */
const UT_BUCKET_SECONDS = 1;

type OrbitReading = ReturnType<
  typeof librationPointsTopics.useTelemetry<"vessel.orbit">
>;

/**
 * The craft's orbit as a claim about now: a current observation, or a held one
 * overlaid by what the conic moved (the phase). A held orbit with no model is
 * not an orbit of now, so there is no craft. `reckoning.value` alone is not an
 * orbit.
 */
function orbitOfNow(reading: OrbitReading) {
  if (reading.state === "observed") {
    return reading.reckoning.status === "available"
      ? { ...reading.value, ...reading.reckoning.value }
      : reading.value;
  }
  if (reading.state === "held" && reading.reckoning.status === "available") {
    return { ...reading.value, ...reading.reckoning.value };
  }
  return undefined;
}

/** The sentence a refusal shows instead of a diagram. */
function refusalCopy(answer: LibrationAnswer): string {
  if (answer.refusal === LIBRATION_REFUSALS.NotAttempted) {
    return "No pair chosen yet, so no libration points have been sought. Pick one above.";
  }
  return answer.because;
}

export function LibrationPointsComponent({
  config,
  id,
}: Readonly<ComponentProps<LibrationPointsConfig>>) {
  const facts = useCatalogue();
  const viewUt = useViewUt()?.magnitude;
  const ut = quantiseUt(
    typeof viewUt === "number" ? viewUt : undefined,
    UT_BUCKET_SECONDS,
  );

  const orbitReading = librationPointsTopics.useTelemetry("vessel.orbit");
  const orbit = orbitOfNow(orbitReading);
  // Only a model carries a held orbit this far, so the craft's figures draw held.
  const orbitHeldSince: HeldSince =
    orbitReading.state === "held" && orbit !== undefined
      ? { asOfUt: orbitReading.asOfUt, grade: orbitReading.grade }
      : null;
  const identityReading = librationPointsTopics.useTelemetry("vessel.identity");
  const identity = stillTrue(identityReading, undefined);

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
          <FieldLabel htmlFor={`${id}-libration-pair`}>Pair</FieldLabel>
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
              <Text level="muted" size="sm">
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
            <LibrationReadouts
              answer={answer}
              offset={offset}
              craftHeldSince={orbitHeldSince}
            />
          </Section>
        ) : null,
      ]}
    />
  );
}

const PAIR_LABEL: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
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
