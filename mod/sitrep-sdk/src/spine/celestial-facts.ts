import {
  type BodyEntry,
  PropagationHorizonKind,
  TrajectoryKind,
} from "../__generated__/contract";
import {
  asStatic,
  isDeterministicValue,
  isValue,
  type Value,
  value,
} from "../unit-system";
import {
  deriveEscapeVelocity,
  derivePeriod,
  deriveTrueAnomalyDeg,
} from "./body-derivations";
import { CORE_UPLINK_CLIENT } from "./uplink-clients";

// ---------------------------------------------------------------------------
// "What do we know about this body?", answered once per Sitrep frame.
//
// ONCE, not once per consumer. A per-consumer memo on `[systemBodies, ut]`
// re-runs the whole map every frame, because `ut` moves every frame, and there
// are four consumers: SystemView's body, SystemView's config component,
// TransferWindow, and `useBodyRotation` (which OrbitView calls precisely to
// AVOID the catalogue cost, while its own first line would pay it).
//
// ## What this DERIVES, and what it only carries
//
// Deliberately small. It derives exactly two things, and both are ours because
// the game has no answer to give:
//
//   escapeVelocity  √(2μ/r). `CelestialBody` has no escape-velocity member at
//                   all, confirmed by a member dump of the installed assembly.
//   trueAnomaly     solved at the FRAME's view time. `Orbit.trueAnomaly` exists
//                   but is the live value, and a delayed console needs the body
//                   where it was when the light left, which the game has no
//                   concept of. This is the only field here that needs a frame,
//                   and so the only reason this is a Processor rather than a
//                   plain function of one Topic.
//   period          `2π√(a³/μ_parent)`, and this one is a judgement rather than a
//                   gap. `Orbit.period` exists, but decompiled it is
//                   `2π/meanMotion` over `meanMotion = √(μ/|a|³)`, which is
//                   character-for-character the expression below. There is no
//                   authority to defer to and no error to fix, only a join to
//                   the parent's `gravParameter` to avoid, and that parent is
//                   already in hand here. So it stays ours, unlike the three
//                   above, each of which closed a real gap.
//
// Everything else is CARRIED from the wire. Mass, surface gravity, hill sphere
// and orbital period were client-side derivations until the contract grew them
// (Sitrep.Contract/SystemPayloads.cs), on the stated grounds that deriving them
// from gravParameter "never wastes wire bytes". That trade cost more than the
// bytes: two of the four were already sampled into the host's own dictionary
// and dropped before they reached the payload, and the hill-sphere derivation
// used the textbook a·(1−e)·∛(m/3M) where KSP uses a·(1−e)·(m/M)^(1/3), so
// every hill sphere the app drew was about 31% too small.
//
// The catalogue is also where the index-to-name question the tree asks in seven
// other places belongs, so `nameByIndex` / `indexByName` ride along: they are a
// function of exactly the same one Topic, they cost a string per body, and a
// body's index is how every other Topic refers to it.
// ---------------------------------------------------------------------------

/**
 * How far a body's orbital elements may be carried forward, as the
 * propagation provider states it: the same horizon a craft's orbit carries,
 * as plain numbers. `untilUt` is an instant, not a duration.
 *
 * In stock KSP every body has {@link ANALYTIC_BODY_HORIZON}: its orbit is
 * fixed, so its position at any UT is known. In an n-body game the provider
 * says how far each body's elements hold.
 *
 * @category Solar system and fleet
 */
export interface BodyHorizon {
  kind: PropagationHorizonKind;
  trajectoryKind: TrajectoryKind;
  /** The last UT these elements hold for; set iff `kind` is `Until`. */
  untilUt: number | null;
}

/**
 * The horizon of a body on a fixed orbit, as in stock KSP: `Unbounded` and
 * `Analytic`. A body whose payload carries no horizon is given this one.
 *
 * @category Solar system and fleet
 */
export const ANALYTIC_BODY_HORIZON: BodyHorizon = Object.freeze({
  kind: PropagationHorizonKind.Unbounded,
  trajectoryKind: TrajectoryKind.Analytic,
  untilUt: null,
});

/**
 * A body's atmosphere. Each field is null when the game did not report it.
 *
 * @category Solar system and fleet
 */
export interface BodyAtmosphere {
  /** Atmosphere height, metres. */
  depth: number | null;
  /** Whether the atmosphere is breathable / oxygenated. */
  hasOxygen: boolean | null;
  /** Sea-level pressure, kPa. */
  seaLevelPressure: number | null;
}

/**
 * A body's figures as `Value`s, as the payload carried them, for showing in a
 * readout: they keep their units and their static mark. Each is `null` when
 * the game did not report it.
 *
 * @category Solar system and fleet
 */
export interface BodyFigures {
  radius: Value<"m"> | null;
  mass: Value<"kg"> | null;
  surfaceGravity: Value<"g"> | null;
  /** The sidereal rotation period's length, with a retrograde sign dropped. */
  dayLength: Value<"s"> | null;
  atmosphereDepth: Value<"m"> | null;
}

/**
 * One body of the solar system, as {@link CelestialFacts} holds it. Numbers
 * here are plain, for drawing and arithmetic: lengths in metres, angles in
 * degrees except the mean anomaly in radians, times in seconds. To show one
 * with its unit, use `figures`. A field is `null` when the game did not report
 * it, and the orbit fields are `null` for the root star.
 *
 * @category Solar system and fleet
 */
export interface CelestialBody {
  /** The body's index in the game. */
  index: number;
  /** The body's name. */
  name: string | null;
  /** The name of the body it orbits. */
  referenceBody: string | null;
  /** Mean radius, metres. */
  radius: number | null;
  /** Sphere-of-influence radius, metres. */
  soi: number | null;
  /** Gravitational parameter (G times mass), m³/s². */
  gravParameter: number | null;
  // ── Orbit (null for the root star) ──────────────────────────────────────
  /** Semi-major axis, metres. */
  semiMajorAxis: number | null;
  /** Eccentricity. */
  eccentricity: number | null;
  /** Inclination, degrees. */
  inclination: number | null;
  /** Longitude of the ascending node, degrees. */
  lan: number | null;
  /** Argument of periapsis, degrees. */
  argumentOfPeriapsis: number | null;
  /** Mean anomaly at `epoch`, radians. */
  meanAnomalyAtEpoch: number | null;
  /** The UT the mean anomaly is for. */
  epoch: number | null;
  /** How far these elements may be carried forward; see {@link BodyHorizon}. */
  horizon: BodyHorizon;
  /**
   * Whether this body's position at any instant is exact: `true` while its
   * horizon is `Unbounded` and `Analytic`, and for the root star. In an n-body
   * game it is `false`, and a figure computed from the body is as old as the
   * catalogue it came from.
   */
  deterministic: boolean;
  /** Orbital period, seconds, computed from the semi-major axis and the parent's gravitational parameter. */
  period: number | null;
  /** True anomaly at the view time, degrees from 0 to 360, computed from the elements. */
  trueAnomaly: number | null;
  /** Mass, kilograms. */
  mass: number | null;
  /** Surface gravity, in g. */
  geeASL: number | null;
  /** Escape velocity at the surface, m/s, computed from the gravitational parameter and radius. */
  escapeVelocity: number | null;
  /** Hill-sphere radius, metres; `null` for the root star. */
  hillSphere: number | null;
  // ── Almanac (on the wire) ───────────────────────────────────────────────
  /** Time for one rotation, seconds. */
  rotationPeriod: number | null;
  /**
   * The body's rotation angle at UT 0, degrees. With `rotationPeriod` it
   * places a point on the surface in the frame the orbit is measured in.
   */
  initialRotation: number | null;
  /** Whether the body always shows the same face to its parent. */
  tidallyLocked: boolean | null;
  /** Whether the body rotates: its rotation period is finite and not zero. */
  rotates: boolean | null;
  /** Whether the body has an ocean. */
  hasOcean: boolean | null;
  /** The game's description of the body. */
  description: string | null;
  /** Atmosphere descriptor; null when the body is airless. */
  atmosphere: BodyAtmosphere | null;
  // ── Atmosphere convenience mirrors (kept for existing consumers) ────────
  /** Whether the body has an atmosphere. */
  hasAtmosphere: boolean | null;
  /** How high the atmosphere reaches, metres; the same as `atmosphere.depth`. */
  maxAtmosphere: number | null;
  /** Whether the atmosphere has oxygen; the same as `atmosphere.hasOxygen`. */
  hasOxygen: boolean | null;
  /** The body's figures with their units, for showing; see {@link BodyFigures}. */
  figures: BodyFigures;
}

/**
 * Every body in the solar system as the latest `system.bodies` describes it,
 * computed once per frame. Read it with `useProcessor(CELESTIAL_FACTS)`.
 *
 * @category Solar system and fleet
 */
export interface CelestialFacts {
  /** Every body, in the order `system.bodies` lists them. */
  bodies: CelestialBody[];
  /** Each body's name by its index. */
  // Plain records, not Maps: the processor compares results structurally, and a Map would differ every frame.
  nameByIndex: Record<number, string>;
  /** Each body's index by its name. */
  indexByName: Record<string, number>;
}

/**
 * The one place a body's wire quantities lose their units.
 *
 * `CelestialBody` is the system diagram's model, and the diagram is arithmetic:
 * semi-major axes get scaled to plot coordinates, radii to pixel radii, and the
 * results go into SVG attributes. It is also where a body's numbers are
 * validated, since a body that has not fully resynced yet arrives with holes in
 * it, and `null` is what the readouts already understand.
 */
function numOrNull(
  x: number | { magnitude: number } | null | undefined,
): number | null {
  const n = typeof x === "object" && x !== null ? x.magnitude : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** The delivered value itself where it is one, so its stamp survives, or a fresh one around a bare magnitude. */
function figureOrNull<Unit extends string>(
  x: Value<Unit> | number | null | undefined,
  unit: Unit,
): Value<Unit> | null {
  if (isValue(x)) return x.isFinite() ? x : null;
  return typeof x === "number" && Number.isFinite(x) ? value(unit, x) : null;
}

/** A figure's size with its sign dropped, still static where the figure was: the sign is a direction, not part of the fact. */
function lengthOf<Unit extends string>(
  figure: Value<Unit> | null,
): Value<Unit> | null {
  if (figure === null) return null;
  return figure.static ? asStatic(figure.abs()) : figure.abs();
}

function boolOrNull(x: boolean | null | undefined): boolean | null {
  return typeof x === "boolean" ? x : null;
}

/**
 * The horizon this body's elements carry, or the analytic reading when the
 * payload carries none; see {@link ANALYTIC_BODY_HORIZON} for why absence reads
 * that way and `Unspecified` does not.
 */
function mapHorizon(wire: BodyEntry["horizon"] | undefined): BodyHorizon {
  if (wire === undefined || wire === null) return ANALYTIC_BODY_HORIZON;
  return {
    kind: wire.kind,
    trajectoryKind: wire.trajectoryKind,
    untilUt: numOrNull(wire.untilUt),
  };
}

/** Whether every element the wire delivered for this orbit carries the deterministic stamp. */
function orbitIsDeterministic(orbit: NonNullable<BodyEntry["orbit"]>): boolean {
  const elements = Object.values(orbit).filter(isValue);
  return elements.length > 0 && elements.every(isDeterministicValue);
}

function mapBody(
  entry: BodyEntry,
  byIndex: Map<number, BodyEntry>,
  ut: number | undefined,
): CelestialBody {
  const parentEntry =
    entry.parentIndex != null ? byIndex.get(entry.parentIndex) : undefined;
  const referenceBody = parentEntry?.name ?? null;
  const parentGravParameter = numOrNull(parentEntry?.gravParameter);

  const radius = numOrNull(entry.radius);
  const gravParameter = numOrNull(entry.gravParameter);

  const orbit = entry.orbit ?? null;
  const semiMajorAxis = orbit ? numOrNull(orbit.sma) : null;
  const eccentricity = orbit ? numOrNull(orbit.ecc) : null;
  const inclination = orbit ? numOrNull(orbit.inc) : null;
  const lan = orbit ? numOrNull(orbit.lan) : null;
  const argumentOfPeriapsis = orbit ? numOrNull(orbit.argPe) : null;
  const meanAnomalyAtEpoch = orbit ? numOrNull(orbit.meanAnomalyAtEpoch) : null;
  const epoch = orbit ? numOrNull(orbit.epoch) : null;

  const rawAtmosphere = entry.atmosphere ?? null;
  const atmosphere: BodyAtmosphere | null = rawAtmosphere
    ? {
        depth: numOrNull(rawAtmosphere.depth),
        hasOxygen: boolOrNull(rawAtmosphere.hasOxygen),
        seaLevelPressure: numOrNull(rawAtmosphere.seaLevelPressure),
      }
    : null;

  const rotationPeriod = numOrNull(entry.rotationPeriod);

  return {
    index: entry.index,
    name: entry.name ?? null,
    referenceBody,
    radius,
    soi: numOrNull(entry.sphereOfInfluence),
    gravParameter,
    semiMajorAxis,
    eccentricity,
    inclination,
    lan,
    argumentOfPeriapsis,
    meanAnomalyAtEpoch,
    epoch,
    horizon: mapHorizon(entry.horizon),
    deterministic: orbit === null || orbitIsDeterministic(orbit),
    period: derivePeriod(semiMajorAxis, parentGravParameter),
    trueAnomaly: deriveTrueAnomalyDeg({
      semiMajorAxis,
      eccentricity,
      meanAnomalyAtEpoch,
      epoch,
      parentGravParameter,
      ut,
    }),
    mass: numOrNull(entry.mass),
    geeASL: numOrNull(entry.surfaceGravity),
    escapeVelocity: deriveEscapeVelocity(gravParameter, radius),
    hillSphere: numOrNull(entry.hillSphere),
    rotationPeriod,
    initialRotation: numOrNull(entry.initialRotation),
    tidallyLocked: boolOrNull(entry.tidallyLocked),
    rotates:
      rotationPeriod === null
        ? null
        : Number.isFinite(rotationPeriod) && rotationPeriod !== 0,
    hasOcean: boolOrNull(entry.hasOcean),
    description: entry.description ?? null,
    atmosphere,
    hasAtmosphere: atmosphere !== null,
    maxAtmosphere: atmosphere?.depth ?? null,
    hasOxygen: atmosphere?.hasOxygen ?? null,
    figures: {
      radius: figureOrNull(entry.radius, "m"),
      mass: figureOrNull(entry.mass, "kg"),
      surfaceGravity: figureOrNull(entry.surfaceGravity, "g"),
      dayLength: lengthOf(figureOrNull(entry.rotationPeriod, "s")),
      atmosphereDepth: figureOrNull(rawAtmosphere?.depth, "m"),
    },
  };
}

/** Nothing known yet. One frozen instance, so an empty catalogue is equal to itself. */
const NOTHING_KNOWN: CelestialFacts = {
  bodies: [],
  nameByIndex: {},
  indexByName: {},
};

/**
 * Returns {@link CelestialFacts} from a `system.bodies` payload's `bodies`,
 * with true anomalies solved at `ut`. The same computation
 * {@link CELESTIAL_FACTS} runs each frame, for use without a running
 * telemetry stream, such as in a test.
 *
 * @category Solar system and fleet
 */
export function deriveCelestialFacts(
  wire: readonly BodyEntry[] | undefined,
  ut: number | undefined,
): CelestialFacts {
  if (!wire || wire.length === 0) return NOTHING_KNOWN;
  const byIndex = new Map<number, BodyEntry>();
  for (const b of wire) byIndex.set(b.index, b);
  const bodies = wire.map((b) => mapBody(b, byIndex, ut));
  const nameByIndex: Record<number, string> = {};
  const indexByName: Record<string, number> = {};
  for (const body of bodies) {
    if (body.name === null) continue;
    nameByIndex[body.index] = body.name;
    indexByName[body.name] = body.index;
  }
  return { bodies, nameByIndex, indexByName };
}

/**
 * The processor that computes {@link CelestialFacts} once per frame. Read it
 * with `useProcessor(CELESTIAL_FACTS)`, or list it in a contribution's `deps`.
 * Do not register a processor with the same id.
 *
 * @category Solar system and fleet
 */
export const CELESTIAL_FACTS = CORE_UPLINK_CLIENT.registerProcessor({
  id: "celestial-facts",
  // A READING rather than the bare payload, so the derivation can tell a
  // catalogue that has arrived from one that has not. A body catalogue is a
  // FACT: it changes when the game changes, and nothing changes it down a link
  // that is not delivering, so a held one is still the catalogue and is used
  // as-is. `pending` and `absent` both mean there is nothing to enrich.
  deps: [{ reading: "system.bodies" }] as const,
  compute: ([reading], frame): CelestialFacts => {
    const known =
      reading.state === "observed" || reading.state === "held"
        ? reading.value
        : undefined;
    // The frame's own frozen view time, which is what puts every body on the
    // same instant. Two consumers reading a wall clock would draw the system at
    // two different moments.
    return deriveCelestialFacts(known?.bodies, frame.viewUt);
  },
});

/**
 * Returns the body with this index, or `null` when the catalogue has none.
 *
 * @category Solar system and fleet
 */
export function bodyAtIndex(
  facts: CelestialFacts | undefined,
  index: number | null | undefined,
): CelestialBody | null {
  if (!facts || index == null) return null;
  return facts.bodies.find((b) => b.index === index) ?? null;
}

/**
 * Returns the body with this name, or `null` when the catalogue has none.
 *
 * @category Solar system and fleet
 */
export function bodyNamed(
  facts: CelestialFacts | undefined,
  name: string | null | undefined,
): CelestialBody | null {
  if (!facts || !name) return null;
  return facts.bodies.find((b) => b.name === name) ?? null;
}
