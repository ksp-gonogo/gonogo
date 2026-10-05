import {
  type OrbitPayloadMeta,
  type PayloadMeta,
  PropagationHorizonKind,
  type Quality,
  type SitrepUnit,
  type TopicPayloadMap,
  TrajectoryKind,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * A contract payload restated as a JSON fixture carries it: every `Value<U>`
 * becomes the `{ magnitude, unit }` pair it serialises to, structure otherwise
 * untouched, optional fields still optional.
 *
 * The runtime `Value` class has arithmetic methods a JSON file can never hold,
 * so a fixture is typed against this rather than against the contract type
 * directly. Everything else is the generated type, so a required wire field
 * left out is a compile error and an invented one is an excess-property error.
 */
export type FixtureOf<Shape> = Shape extends {
  readonly magnitude: number;
  readonly unit: infer Unit extends SitrepUnit;
}
  ? { magnitude: number; unit: Unit }
  : Shape extends readonly (infer Element)[]
    ? FixtureOf<Element>[]
    : Shape extends (...args: never[]) => unknown
      ? Shape
      : Shape extends object
        ? { [Key in keyof Shape]: FixtureOf<Shape[Key]> }
        : Shape;

/**
 * The payload of one Topic as a fixture, with every required field a compile
 * error to omit. Nothing is defaulted: a field the fixture does not state is
 * not on the wire, and the builder will not state it for you.
 */
export function topicFixture<Topic extends keyof TopicPayloadMap>(
  _topic: Topic,
  payload: FixtureOf<TopicPayloadMap[Topic]>,
): FixtureOf<TopicPayloadMap[Topic]> {
  return payload;
}

/** The `meta` the mod sends on `vessel.orbit`: the craft it belongs to and whether KSP is simulating it. */
export function orbitMeta(
  vesselId: string,
  quality: Quality,
): OrbitPayloadMeta {
  return { source: `vessel:${vesselId}`, quality };
}

/** The `meta` the mod sends on the vessel Topics other than `vessel.orbit`. */
export function vesselMeta(vesselId: string): PayloadMeta {
  return { source: `vessel:${vesselId}` };
}

/** What the stock conic solver stamps on an element set: valid for good, and a closed-form conic. */
export function analyticHorizon() {
  return {
    kind: PropagationHorizonKind.Unbounded,
    trajectoryKind: TrajectoryKind.Analytic,
  };
}

/** An integrated path's snapshot, good only until `untilUt`. */
export function integratedHorizon(untilUt: number) {
  return {
    kind: PropagationHorizonKind.Until,
    trajectoryKind: TrajectoryKind.Integrated,
    untilUt: { magnitude: untilUt, unit: "ut" as const },
  };
}
