import type { BodyEntry } from "../__generated__/contract";
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

export interface BodyAtmosphere {
  /** Atmosphere height, metres. */
  depth: number | null;
  /** Whether the atmosphere is breathable / oxygenated. */
  hasOxygen: boolean | null;
  /** Sea-level pressure, kPa. */
  seaLevelPressure: number | null;
}

export interface CelestialBody {
  index: number;
  name: string | null;
  referenceBody: string | null;
  radius: number | null;
  /** Sphere-of-influence radius, metres. */
  soi: number | null;
  /** Standard gravitational parameter μ = G·M, m³/s², the compute primitive. */
  gravParameter: number | null;
  // ── Orbit (null for the root star) ──────────────────────────────────────
  semiMajorAxis: number | null;
  eccentricity: number | null;
  inclination: number | null;
  lan: number | null;
  argumentOfPeriapsis: number | null;
  meanAnomalyAtEpoch: number | null;
  epoch: number | null;
  /** Orbital period, seconds: derived `2π√(a³/μ_parent)`. OURS, and see below. */
  period: number | null;
  /** True anomaly, degrees in [0, 360), solved for the frame's view time. OURS. */
  trueAnomaly: number | null;
  /** Mass, kg (`CelestialBody.Mass` on the wire). */
  mass: number | null;
  /** Surface gravity in g (`CelestialBody.GeeASL` on the wire, verbatim). */
  geeASL: number | null;
  /** Escape velocity, m/s: derived `√(2μ/r)`. The game has no such member. OURS. */
  escapeVelocity: number | null;
  /** Hill-sphere radius, metres (`CelestialBody.hillSphere` on the wire); null for the root star. */
  hillSphere: number | null;
  // ── Almanac (on the wire) ───────────────────────────────────────────────
  rotationPeriod: number | null;
  tidallyLocked: boolean | null;
  /** Whether the body rotates: derived (rotationPeriod finite and non-zero). */
  rotates: boolean | null;
  hasOcean: boolean | null;
  description: string | null;
  /** Atmosphere descriptor; null when the body is airless. */
  atmosphere: BodyAtmosphere | null;
  // ── Atmosphere convenience mirrors (kept for existing consumers) ────────
  /** `atmosphere !== null`. */
  hasAtmosphere: boolean | null;
  /** `atmosphere?.depth`. */
  maxAtmosphere: number | null;
  /** `atmosphere?.hasOxygen`. */
  hasOxygen: boolean | null;
}

/** What the catalogue knows, this frame. */
export interface CelestialFacts {
  /** Every body the system carries, in wire order, enriched. */
  bodies: CelestialBody[];
  /**
   * Body index to name, and back.
   *
   * Plain records of primitives rather than `Map`s, and that is load-bearing
   * rather than a style choice: the evaluator gates its fan-out on a structural
   * comparison of the RESULT that walks plain objects, arrays, primitives and
   * `Value`s, and compares anything else by identity. A `Map` in here would
   * compare unequal on every frame and wake every consumer of the catalogue,
   * which is the exact churn the notification budget exists to catch.
   */
  nameByIndex: Record<number, string>;
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

function boolOrNull(x: boolean | null | undefined): boolean | null {
  return typeof x === "boolean" ? x : null;
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
  };
}

/** Nothing known yet. One frozen instance, so an empty catalogue is equal to itself. */
const NOTHING_KNOWN: CelestialFacts = {
  bodies: [],
  nameByIndex: {},
  indexByName: {},
};

/**
 * The whole derivation, pure. Exported so a test can exercise it directly
 * without a live evaluator, the way every processor in the tree exposes its
 * derivation beside its handle.
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
 * `core:celestial-facts`. The owner-stamped Processor handle. Import it to
 * consume the catalogue, never re-declare it: a second registration under the
 * same id with a different compute throws (processors.ts).
 */
export const CELESTIAL_FACTS = CORE_UPLINK_CLIENT.registerProcessor({
  id: "celestial-facts",
  // A READING rather than the bare payload, so the derivation can tell a
  // catalogue that has arrived from one that has not. A body catalogue is a
  // FACT: it changes when the game changes, and nothing changes it down a link
  // that is not delivering, so a stale one is still the catalogue and is used
  // as-is. `pending` and `absent` both mean there is nothing to enrich.
  deps: [{ reading: "system.bodies" }] as const,
  compute: ([reading], frame): CelestialFacts => {
    const known =
      reading.state === "observed" || reading.state === "stale"
        ? reading.value
        : undefined;
    // The frame's own frozen view time, which is what puts every body on the
    // same instant. Two consumers reading a wall clock would draw the system at
    // two different moments.
    return deriveCelestialFacts(known?.bodies, frame.viewUt);
  },
});

/**
 * The enriched entry for one body index, or `null` when the catalogue does not
 * carry it. A linear scan over a system-sized list, deliberately: an index-keyed
 * copy of every body would double the evaluator's structural comparison for a
 * lookup that costs nothing at seventeen bodies.
 */
export function bodyAtIndex(
  facts: CelestialFacts | undefined,
  index: number | null | undefined,
): CelestialBody | null {
  if (!facts || index == null) return null;
  return facts.bodies.find((b) => b.index === index) ?? null;
}

/** The enriched entry for one body name, or `null` when the catalogue does not carry it. */
export function bodyNamed(
  facts: CelestialFacts | undefined,
  name: string | null | undefined,
): CelestialBody | null {
  if (!facts || !name) return null;
  return facts.bodies.find((b) => b.name === name) ?? null;
}
