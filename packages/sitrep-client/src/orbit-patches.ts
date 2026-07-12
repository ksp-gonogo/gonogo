/**
 * The vessel's future-orbit patch chain (`vessel.orbit.patches` / each
 * `vessel.maneuver.nodes[].patches`, `mod/Sitrep.Contract/OrbitPatch.cs`) —
 * reshaped into the legacy Telemachus `OrbitPatch` shape MapView/
 * `packages/core/src/calc/trajectory.ts` already consume (`o.orbitPatches`,
 * `ManeuverNode.orbitPatches`), plus a narrow vacuum-ballistic impact-point
 * walk over that same chain (`land.predictedLat`/`Lon`'s source — see
 * `vessel-state.ts`'s `deriveLanding`).
 */

/**
 * Wire shape of one `OrbitPatch` entry (mirrors `mod/Sitrep.Contract/
 * OrbitPatch.cs`). Hand-mirrored, same convention as `VesselOrbitPayload`
 * in `vessel-state.ts` — not (yet) generated into this package.
 */
export interface OrbitPatchWirePayload {
  sma: number;
  ecc: number;
  inc: number;
  lan: number;
  argPe: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
  period: number;
  startUt: number;
  endUt: number;
  /** Raw `Sitrep.Contract.TransitionType` ordinal — see `transitionName`. */
  patchStartTransition: number;
  patchEndTransition: number;
  peA: number;
  apA: number;
  semiLatusRectum: number;
  semiMinorAxis: number;
  referenceBody: string;
  closestEncounterBody?: string | null;
}

/**
 * The legacy `o.orbitPatches`/`ManeuverNode.orbitPatches` shape
 * (`@ksp-gonogo/core`'s `OrbitPatch`, `packages/core/src/schemas/
 * orbit.ts`) — re-declared HERE, structurally identical but not
 * imported, because `sitrep-client` cannot depend on `@ksp-gonogo/core`
 * (the dependency points the other way: core depends on sitrep-client — see
 * `core`'s `package.json`). TypeScript's structural typing makes the two
 * interchangeable at every call site that matters (`@ksp-gonogo/core`'s
 * `predictGroundTrack` accepts this shape with no cast needed).
 */
export interface LegacyOrbitPatch {
  startUT: number;
  endUT: number;
  patchStartTransition: string;
  patchEndTransition: string;
  PeA: number;
  ApA: number;
  inclination: number;
  eccentricity: number;
  epoch: number;
  period: number;
  argumentOfPeriapsis: number;
  sma: number;
  lan: number;
  maae: number;
  referenceBody: string;
  semiLatusRectum: number;
  semiMinorAxis: number;
  closestEncounterBody: string | null;
}

/**
 * `Sitrep.Contract.TransitionType` ordinal → the uppercase name legacy
 * Telemachus's own `OrbitPatchJSONFormatter` used (`packages/core/src/
 * schemas/orbit.ts`'s `OrbitPatch.patchStartTransition` doc comment).
 * Declaration order matches `mod/Sitrep.Contract/VesselEnums.cs`'s
 * `TransitionType` (Initial/Final/Encounter/Escape/Maneuver/Collision/
 * Unknown) — same ordinal-table pattern as `vessel-state.ts`'s
 * `SITUATION_NAMES`/`SAS_MODE_NAMES`. KSP's OWN enum spells the impact case
 * "IMPACT"; `Gonogo.KSP.KspHost.BuildOrbitPatchChain` already translates
 * that to "COLLISION" before it reaches the wire, so this table only ever
 * needs the `TransitionType` spelling.
 */
const TRANSITION_TYPE_NAMES: readonly string[] = [
  "INITIAL",
  "FINAL",
  "ENCOUNTER",
  "ESCAPE",
  "MANEUVER",
  "COLLISION",
  "UNKNOWN",
];

function transitionName(ordinal: number): string {
  return TRANSITION_TYPE_NAMES[ordinal] ?? "UNKNOWN";
}

/**
 * Reshapes one wire `OrbitPatch` into the legacy shape `predictGroundTrack`
 * (and MapView's overlay) already consume unchanged — a pure field rename/
 * passthrough, no lookup needed: `referenceBody`/`closestEncounterBody` are
 * already body NAME strings on the wire (see `OrbitPatch.cs`'s doc comment
 * for why), unlike most of this codebase's index-based body references.
 */
export function mapOrbitPatch(wire: OrbitPatchWirePayload): LegacyOrbitPatch {
  return {
    startUT: wire.startUt,
    endUT: wire.endUt,
    patchStartTransition: transitionName(wire.patchStartTransition),
    patchEndTransition: transitionName(wire.patchEndTransition),
    PeA: wire.peA,
    ApA: wire.apA,
    inclination: wire.inc,
    eccentricity: wire.ecc,
    epoch: wire.epoch,
    period: wire.period,
    argumentOfPeriapsis: wire.argPe,
    sma: wire.sma,
    lan: wire.lan,
    maae: wire.meanAnomalyAtEpoch,
    referenceBody: wire.referenceBody,
    semiLatusRectum: wire.semiLatusRectum,
    semiMinorAxis: wire.semiMinorAxis,
    closestEncounterBody: wire.closestEncounterBody ?? null,
  };
}

// ---------------------------------------------------------------------------
// Impact-point propagation — a narrow, LOCAL copy of the vacuum-ballistic
// patch-walk `@ksp-gonogo/core`'s `packages/core/src/calc/trajectory.ts`
// (`predictGroundTrack`) already implements for MapView's rendered ground
// track. Duplicated rather than imported because `sitrep-client` cannot
// depend on `@ksp-gonogo/core` (see `LegacyOrbitPatch`'s doc comment above)
// — a real cost, flagged here rather than hidden; a future refactor could
// relocate the shared math to a layer both packages can reach without a
// circular dependency. This copy is intentionally NARROWER than
// `predictGroundTrack`: it returns only the LAST pre-surface sample (the
// impact point), not a renderable polyline, so it skips the longitude-wrap
// segmentation and the per-call `PerfBudget` `predictGroundTrack` needs for
// its render-loop call pattern — this function is only ever invoked from a
// horizon-bounded `deriveLanding` evaluation (see that function's doc
// comment for the bound), never per-frame unbounded.
// ---------------------------------------------------------------------------

function normalisePi(rad: number): number {
  const twoPi = 2 * Math.PI;
  let x = rad % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x <= -Math.PI) x += twoPi;
  return x;
}

/** Solve Kepler's equation `E - e·sin E = M` for the eccentric anomaly E. Newton iteration, same tolerance/cap as `trajectory.ts`'s `solveKepler`. */
function solveKepler(meanAnomaly: number, eccentricity: number): number {
  const M = normalisePi(meanAnomaly);
  let E = M + eccentricity * Math.sin(M);
  for (let i = 0; i < 50; i++) {
    const f = E - eccentricity * Math.sin(E) - M;
    const fp = 1 - eccentricity * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-10) return E;
  }
  return E;
}

function eccentricToTrueAnomaly(E: number, e: number): number {
  const y = Math.sqrt(1 + e) * Math.sin(E / 2);
  const x = Math.sqrt(1 - e) * Math.cos(E / 2);
  return 2 * Math.atan2(y, x);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wrap a degree value to (-180, 180]. */
function wrap180(deg: number): number {
  let x = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (x <= -180) x = 180;
  return x;
}

interface InertialState {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Vessel's inertial state at an arbitrary UT within `patch` — same math as `trajectory.ts`'s `patchStateAt`. */
function patchStateAt(patch: LegacyOrbitPatch, ut: number): InertialState {
  const dt = ut - patch.epoch;
  const n = (2 * Math.PI) / patch.period;
  const M = patch.maae + n * dt;
  const E = solveKepler(M, patch.eccentricity);
  const nu = eccentricToTrueAnomaly(E, patch.eccentricity);
  const r = patch.sma * (1 - patch.eccentricity * Math.cos(E));

  const xPf = r * Math.cos(nu);
  const yPf = r * Math.sin(nu);

  const w = degToRad(patch.argumentOfPeriapsis);
  const i = degToRad(patch.inclination);
  const O = degToRad(patch.lan);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosO = Math.cos(O);
  const sinO = Math.sin(O);

  const p0 = cosO * cosW - sinO * sinW * cosI;
  const p1 = sinO * cosW + cosO * sinW * cosI;
  const p2 = sinW * sinI;
  const q0 = -cosO * sinW - sinO * cosW * cosI;
  const q1 = -sinO * sinW + cosO * cosW * cosI;
  const q2 = cosW * sinI;

  return {
    x: p0 * xPf + q0 * yPf,
    y: p1 * xPf + q1 * yPf,
    z: p2 * xPf + q2 * yPf,
    radius: r,
  };
}

interface GeoState {
  lat: number;
  alt: number;
  lonInertial: number;
}

function geoFromInertial(state: InertialState, bodyRadius: number): GeoState {
  const lat = radToDeg(Math.asin(state.z / state.radius));
  const lonInertial = radToDeg(Math.atan2(state.y, state.x));
  return { lat, lonInertial, alt: state.radius - bodyRadius };
}

export interface PredictionRef {
  /** Current universal time, seconds. */
  ut: number;
  /** Vessel latitude at `ut`, degrees. */
  lat: number;
  /** Vessel body-fixed longitude at `ut`, degrees. */
  lon: number;
}

/** Body-fixed-longitude converter calibrated against the vessel's current ground position — same construction as `trajectory.ts`'s `buildBodyRotation`. */
function buildBodyRotation(
  referencePatch: LegacyOrbitPatch,
  ref: PredictionRef,
  rotationPeriod: number,
): (inertialLon: number, ut: number) => number {
  const refState = patchStateAt(referencePatch, ref.ut);
  const refInertialLon = radToDeg(Math.atan2(refState.y, refState.x));
  const rotationOffsetAtRef = refInertialLon - ref.lon;
  const omega = 360 / rotationPeriod;
  return (inertialLon: number, ut: number): number =>
    wrap180(inertialLon - rotationOffsetAtRef - omega * (ut - ref.ut));
}

/** A patch is propagable with the elliptical solver above — hyperbolic/parabolic trajectories aren't. */
function isPatchElliptical(patch: LegacyOrbitPatch): boolean {
  return (
    patch.eccentricity < 1 && Number.isFinite(patch.period) && patch.period > 0
  );
}

/** Altitude below which a sample counts as "at/below the surface" — same threshold `predictGroundTrack` uses. */
const MIN_IMPACT_ALT_M = -100;

export interface ImpactPoint {
  lat: number;
  lon: number;
}

/**
 * Walks the patch chain forward from `ref.ut` and returns the LAST sample
 * before altitude drops below `MIN_IMPACT_ALT_M` — the predicted surface
 * impact point. `null` when the walk never dips below the surface within
 * `horizonSec` (no prediction — never a fabricated `(0,0)`, unlike
 * Telemachus's own sentinel convention; see `LandingStatus`'s `isSentinel`
 * for the widget-side null handling). Bound `horizonSec`/`stepSec` tightly
 * at the call site — this is an O(horizonSec / stepSec) loop with no
 * internal sample cap.
 */
export function findImpactPoint(
  patches: readonly LegacyOrbitPatch[],
  bodyId: string,
  bodyRadius: number,
  rotationPeriod: number,
  ref: PredictionRef,
  horizonSec: number,
  stepSec: number,
): ImpactPoint | null {
  if (patches.length === 0 || stepSec <= 0 || horizonSec <= 0) return null;

  const calCandidates = patches.filter(
    (p) => p.referenceBody === bodyId && isPatchElliptical(p),
  );
  const refPatch =
    calCandidates.find((p) => ref.ut >= p.startUT && ref.ut <= p.endUT) ??
    calCandidates[0];
  if (!refPatch) return null;

  const toBodyLon = buildBodyRotation(refPatch, ref, rotationPeriod);
  const endUT = ref.ut + horizonSec;

  let last: ImpactPoint | null = null;
  for (const patch of patches) {
    if (patch.referenceBody !== bodyId) break; // SOI change — stop.
    if (!isPatchElliptical(patch)) break;
    if (patch.endUT < ref.ut) continue; // Already finished.
    if (patch.startUT > endUT) break; // Past horizon.

    const from = Math.max(patch.startUT, ref.ut);
    const to = Math.min(patch.endUT, endUT);
    for (let ut = from; ut <= to; ut += stepSec) {
      const state = patchStateAt(patch, ut);
      const geo = geoFromInertial(state, bodyRadius);
      if (geo.alt < MIN_IMPACT_ALT_M) {
        return last;
      }
      last = { lat: geo.lat, lon: toBodyLon(geo.lonInertial, ut) };
    }
  }
  return null;
}

/**
 * Sidereal rotation period (seconds) for the stock KSP bodies, hand-mirrored
 * from `@ksp-gonogo/core`'s static body registry
 * (`packages/core/src/stock-bodies.ts`) — `sitrep-client` cannot import
 * `@ksp-gonogo/core` (see `LegacyOrbitPatch`'s doc comment), and this is the
 * only physical constant `findImpactPoint` needs that isn't already on the
 * wire (body mean radius comes live off `system.bodies`, same lookup
 * `deriveApsides`/`deriveLanding` already use). Same accepted stock-only
 * limitation MapView's own trajectory prediction already carries via
 * `getBody()` — not a new gap. Keep in sync if `stock-bodies.ts`'s rotation
 * periods change; a body missing from this table simply gets no landing
 * prediction (see `deriveLanding`'s `null` fallback), same honest-absence
 * discipline as everywhere else in this file.
 */
export const ROTATION_PERIOD_SECONDS: Readonly<Record<string, number>> = {
  Kerbol: 432000,
  Moho: 1210000,
  Eve: 80500,
  Gilly: 28255,
  Kerbin: 21549.425,
  Mun: 138984.38,
  Minmus: 40400,
  Duna: 65517.859,
  Ike: 65517.862,
  Dres: 34800,
  Jool: 36000,
  Laythe: 52980.879,
  Vall: 105962.09,
  Tylo: 211926.36,
  Bop: 544507.43,
  Pol: 901902.62,
  Eeloo: 19460,
};
