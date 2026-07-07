import { Quality } from "@gonogo/sitrep-sdk";
import type { OrbitElements, Vector3 } from "./kepler";
import { solve } from "./kepler";
import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";

/**
 * The `vessel.orbit` channel payload — elements, never position (M2 design
 * §2.4, mirrors `mod/Sitrep.Contract/VesselOrbit.cs`). Not yet codegen'd into
 * `@gonogo/sitrep-sdk`'s `__generated__/contract.ts` (that's the mod-side
 * channel-payload codegen, out of this task's scope) — hand-mirrored here so
 * `deriveVesselState` has a typed shape to read. Keep in sync with the C#
 * source until codegen catches up.
 *
 * Units, verbatim from the C# doc comment: `sma` in metres; `inc`/`lan`/
 * `argPe` in DEGREES (KSP-native); `meanAnomalyAtEpoch` in RADIANS (also
 * KSP-native) — an inherited KSP inconsistency, deliberately kept. `lan`/
 * `argPe` are `null` for an undefined ascending node / periapsis (near-
 * equatorial / near-circular orbits) — never NaN, never a fake 0.
 */
export interface VesselOrbitPayload {
  referenceBodyIndex: number;
  sma: number;
  ecc: number;
  inc: number;
  lan: number | null;
  argPe: number | null;
  meanAnomalyAtEpoch: number;
  epoch: number;
  mu: number;
}

/**
 * The `vessel.flight` channel payload — measurements, not evaluations
 * (mirrors `mod/Sitrep.Contract/VesselFlight.cs`). Same hand-mirroring note
 * as `VesselOrbitPayload` above.
 */
export interface VesselFlightPayload {
  latitude: number;
  longitude: number;
  altitudeAsl: number;
  altitudeTerrain: number;
  verticalSpeed: number;
  surfaceSpeed: number;
  orbitalSpeed: number;
  gForce: number;
  dynamicPressureKPa: number;
  mach: number;
  atmDensity: number;
}

/**
 * The quality-picked, widget-facing kinematic surface (M2 design §2.4; M1
 * §6.2/§8.2's `vessel.state` obligation — the V-12 dual-altitude fix).
 *
 * Scope note: this T3 cut derives ONLY from `vessel.orbit` + `vessel.flight`
 * (no `system.bodies`/`vessel.identity` inputs yet), so fields that need body
 * geometry (altitude-from-propagated-position, lat/long from rotation,
 * apsides, MET) are out of scope here and deferred to a later task that adds
 * those inputs. `altitudeAsl`/`verticalSpeed`/`surfaceSpeed` are populated
 * only in the "measured" (Loaded) basis, straight off `vessel.flight` — see
 * `deriveVesselState`'s doc for why the "propagated" (OnRails) basis leaves
 * them `null` rather than fabricating a body-less approximation.
 */
export interface VesselState {
  /** Parent-body-relative, metres. `null` in the "measured" basis — `vessel.flight` carries no position vector (needs `system.bodies` to reconstruct one; deferred). */
  position: Vector3 | null;
  /** Parent-body-relative, m/s. `null` in the "measured" basis, same reason as `position`. */
  velocity: Vector3 | null;
  /** Metres above sea level. `null` in the "propagated" basis (needs `system.bodies` radius; deferred) — always sourced from `vessel.flight.altitudeAsl` in the "measured" basis. */
  altitudeAsl: number | null;
  verticalSpeed: number | null;
  surfaceSpeed: number | null;
  /** m/s. Populated in BOTH bases: propagated from `|velocity|` when on-rails, taken straight from `vessel.flight.orbitalSpeed` when loaded. */
  orbitalSpeed: number | null;
  /** Which path produced this record's kinematics — never a widget's choice (M1 §6.2's V-12 fix). */
  basis: "propagated" | "measured";
  /** `vessel:<guid>` — subject provenance, from the orbit sample's envelope `meta.source` (M1 §6.1). */
  subjectId: string;
}

function magnitude(v: Vector3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * The `vessel.state` derivation (M2 design §2.4/§9.1). Reads `vessel.orbit`
 * + `vessel.flight` at the SAME frozen `viewUt` (the `get` closure enforces
 * this structurally — see `TimelineStore`) and quality-picks per
 * `Meta.Quality`, keyed off the ORBIT sample's quality specifically ("the
 * picker input is the quality on the orbit sample at viewUt" — M2 design
 * §2.4 — so a historical scrub through a regime change replays the switch
 * faithfully from archived quality stamps, not a live global flag):
 *
 * - **OnRails** (coasting): `vessel.orbit` is the CAUSE. Convert the wire's
 *   degrees→radians ONCE here (`meanAnomalyAtEpoch` is already radians — the
 *   documented KSP unit-convention quirk), substitute 0 for a `null`
 *   `lan`/`argPe` (the physically-degenerate near-equatorial/near-circular
 *   case — substituting 0 doesn't change the resulting state vector, it just
 *   picks an arbitrary node/apsis reference on a circle where none is
 *   physically distinguished), then `kepler.solve(elements, viewUt)` for
 *   position/velocity. `basis: "propagated"`.
 * - **Loaded** (powered/atmospheric): elements are osculating garbage for
 *   surface quantities, so altitude/vertical/surface speed come straight off
 *   `vessel.flight` at `viewUt` (hold-last via `get()`; real straddle-based
 *   linear interpolation is the natural extension once `get` grows an
 *   interpolating variant — `ClientTimeline.straddle` is already the seam
 *   for it, per its own doc comment — deferred here to keep this task's
 *   surface small). `basis: "measured"`.
 *
 * **Missing inputs → `null`, never a fabricated zero** (this task's explicit
 * contract): no `vessel.orbit` point at-or-before `viewUt` yet (cold start,
 * post-epoch-reset resync, or a tombstoned orbit) means there is no quality
 * signal to pick with, so the whole record is `null`. Loaded quality with no
 * `vessel.flight` point yet is `null` for the same reason — the measured
 * regime has nothing to interpolate/hold.
 */
export function deriveVesselState(
  get: DerivedGet,
  viewUt: number,
): VesselState | null {
  const orbitPoint = get<VesselOrbitPayload>("vessel.orbit");
  if (!orbitPoint || orbitPoint.payload === null) return null;

  const quality = orbitPoint.meta.quality;
  const subjectId = orbitPoint.meta.source;
  const orbit = orbitPoint.payload;

  if (quality === Quality.OnRails) {
    const elements: OrbitElements = {
      sma: orbit.sma,
      ecc: orbit.ecc,
      inc: degToRad(orbit.inc),
      lan: orbit.lan == null ? 0 : degToRad(orbit.lan),
      argPe: orbit.argPe == null ? 0 : degToRad(orbit.argPe),
      meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
      epoch: orbit.epoch,
      mu: orbit.mu,
    };
    const { position, velocity } = solve(elements, viewUt);

    return {
      position,
      velocity,
      altitudeAsl: null,
      verticalSpeed: null,
      surfaceSpeed: null,
      orbitalSpeed: magnitude(velocity),
      basis: "propagated",
      subjectId,
    };
  }

  // Loaded.
  const flightPoint = get<VesselFlightPayload>("vessel.flight");
  if (!flightPoint || flightPoint.payload === null) return null;
  const flight = flightPoint.payload;

  return {
    position: null,
    velocity: null,
    altitudeAsl: flight.altitudeAsl,
    verticalSpeed: flight.verticalSpeed,
    surfaceSpeed: flight.surfaceSpeed,
    orbitalSpeed: flight.orbitalSpeed,
    basis: "measured",
    subjectId,
  };
}

/**
 * Ready-to-register definition — `store.registerDerivedChannel(vesselStateChannel)`.
 * `fields: true` exposes `vessel.state.<field>` subtopics (e.g.
 * `vessel.state.altitudeAsl`) reading off this one memoized record, per
 * `TimelineStore`'s field-subtopic mechanism.
 */
export const vesselStateChannel: DerivedChannelDefinition<VesselState> = {
  topic: "vessel.state",
  inputs: ["vessel.orbit", "vessel.flight"],
  derive: deriveVesselState,
  fields: true,
};
