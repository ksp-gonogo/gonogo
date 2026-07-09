import { Quality } from "@gonogo/sitrep-sdk";
import type { OrbitElements, Vector3 } from "./kepler";
import { solve, solveAnomalies } from "./kepler";
import type { StreamStatusValue } from "./stream-status";
import { worstStatus } from "./stream-status";
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
 * The `vessel.identity` channel payload — hand-mirrored subset relevant to
 * `deriveVesselState`'s `met` field (mirrors `mod/Sitrep.Contract/
 * VesselIdentity.cs`; envelope `Meta`, same as `VesselOrbitPayload`/
 * `VesselFlightPayload` above, is not part of this payload shape). `vesselType`/
 * `situation` are the raw C# enum ordinals on the wire (no TS enum exists yet
 * for either — see `map-topic.ts`'s note on `v.situationString`).
 *
 * `launchUt`: sampleUt - missionTime; `null` before the vessel's launch clock
 * has started (see the C# class doc) — the source of `VesselState.met`'s own
 * `null`-before-launch case.
 */
export interface VesselIdentityPayload {
  vesselId: string;
  name: string;
  vesselType: number;
  situation: number;
  parentBodyIndex: number | null;
  launchUt: number | null;
}

/** One body's orbital elements within `system.bodies` — `null` only for the root star (mirrors `SystemViewProvider.BuildOrbit`). Units match `VesselOrbitPayload`'s (degrees for inc/lan/argPe, radians for meanAnomalyAtEpoch). */
export interface SystemBodyOrbitPayload {
  sma: number | null;
  ecc: number | null;
  inc: number | null;
  lan: number | null;
  argPe: number | null;
  meanAnomalyAtEpoch: number | null;
  epoch: number | null;
}

/** One entry in the `system.bodies` array (mirrors `SystemViewProvider.BuildBody`). `index` — not array position — is the stable id `vessel.orbit.referenceBodyIndex`/`vessel.identity.parentBodyIndex` point at. */
export interface SystemBodyPayload {
  name: string | null;
  index: number;
  parentIndex: number | null;
  /** Mean radius, metres. `null` when the live game hasn't reported it yet. */
  radius: number | null;
  orbit: SystemBodyOrbitPayload | null;
}

/** The `system.bodies` channel payload (mirrors `SystemViewProvider.BuildSystemBodies`'s `{ "bodies": [...] }` shape) — the source of `VesselState.apoapsisAlt`/`periapsisAlt`'s reference-body radius. */
export interface SystemBodiesPayload {
  bodies: SystemBodyPayload[];
}

/**
 * The quality-picked, widget-facing kinematic surface (M2 design §2.4; M1
 * §6.2/§8.2's `vessel.state` obligation — the V-12 dual-altitude fix).
 *
 * Scope note: the original T3 cut derived ONLY from `vessel.orbit` +
 * `vessel.flight` (no `system.bodies`/`vessel.identity` inputs), so fields
 * needing body geometry or the launch clock were out of scope. This M3 task
 * adds seven fields that ARE derivable from already-served data —
 * `met`/`period`/`trueAnomaly`/`apoapsisAlt`/`periapsisAlt`/`timeToAp`/
 * `timeToPe` — reading `vessel.identity` (for `met`'s `launchUt`) and
 * `system.bodies` (for the apsides' reference-body radius) alongside the
 * original two inputs. `altitude-from-propagated-position`/`lat-long-from-
 * rotation` still need more than these seven do and remain deferred.
 * `altitudeAsl`/`verticalSpeed`/`surfaceSpeed` are populated only in the
 * "measured" (Loaded) basis, straight off `vessel.flight` — see
 * `deriveVesselState`'s doc for why the "propagated" (OnRails) basis leaves
 * them `null` rather than fabricating a body-less approximation. The seven
 * new fields below take the OPPOSITE split — orbital-elements-derived, so
 * they're OnRails-only and `null` in the "measured" basis, same reasoning
 * (Loaded-basis orbital elements are osculating garbage, not a trajectory
 * worth deriving a period/apsis/anomaly from — this file's own doc on the
 * OnRails/Loaded branches explains the "osculating garbage" call).
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
  /**
   * Mission elapsed time, seconds: `viewUt - vessel.identity.launchUt`.
   * OnRails basis only (see class doc); `null` in the "measured" basis,
   * before launch (`launchUt` still `null` on `vessel.identity`), while
   * `vessel.identity` hasn't arrived yet (a secondary input — its absence
   * nulls this ONE field, not the whole record), or on a non-finite result.
   */
  met: number | null;
  /**
   * Orbital period, seconds: `2π·sqrt(sma³/mu)`. OnRails basis only; `null`
   * in the "measured" basis or on a non-finite result (e.g. a degenerate
   * `mu`).
   */
  period: number | null;
  /**
   * True anomaly at `viewUt`, DEGREES wrapped to [0, 360) — the Telemachus/
   * KSP widget-facing convention (`vessel.orbit.inc`/`argPe`'s own
   * precedent; `kepler.ts`'s internal radians are converted at this
   * boundary, never leaked past it). OnRails basis only; `null` in the
   * "measured" basis. Reuses `kepler.solveAnomalies` — never a second Kepler
   * solve.
   */
  trueAnomaly: number | null;
  /**
   * Apoapsis altitude above the reference body's mean radius, metres:
   * `sma·(1+ecc) - bodyRadius`. OnRails basis only. `undefined` while
   * `system.bodies` isn't whole yet, or is whole but doesn't (yet) carry the
   * referenced body's radius — both "still resyncing", never conflated with
   * `null` (see the class-level `undefined` vs `null` discipline, applied
   * here at the FIELD level: `system.bodies` tombstoned is a confirmed
   * absence and DOES map to `null`). `null` in the "measured" basis or on a
   * non-finite result.
   */
  apoapsisAlt: number | null | undefined;
  /** Periapsis altitude above the reference body's mean radius, metres: `sma·(1-ecc) - bodyRadius`. Same basis/`undefined`-vs-`null` rules as `apoapsisAlt`. */
  periapsisAlt: number | null | undefined;
  /**
   * Seconds from `viewUt` until the mean anomaly next reaches apoapsis (π),
   * wrapped forward — 0 if already there. OnRails basis only; `null` in the
   * "measured" basis or on a non-finite/non-positive mean motion.
   */
  timeToAp: number | null;
  /** Seconds from `viewUt` until the mean anomaly next reaches periapsis (0), wrapped forward. Same basis/finite-guard rules as `timeToAp`. */
  timeToPe: number | null;
  /**
   * Name of the body the vessel currently belongs to — the display-map
   * resolution of `vessel.identity.parentBodyIndex` against `system.bodies`
   * (the old Telemachus `v.body` string). Populated in BOTH bases (needs only
   * the index + the body table, no orbital propagation). `undefined` while
   * `vessel.identity` hasn't arrived, the index isn't resolvable yet (body or
   * its name not in `system.bodies` yet, or `system.bodies` itself not whole),
   * or there is no parent index at all; `null` when `system.bodies` is a
   * confirmed tombstone — same `undefined`-vs-`null` "still resyncing vs.
   * confirmed absent" discipline as `apoapsisAlt`/`periapsisAlt`.
   */
  parentBodyName: string | null | undefined;
  /**
   * Name of the vessel's orbit reference body — the display-map resolution of
   * `vessel.orbit.referenceBodyIndex` against `system.bodies` (the old
   * Telemachus `o.referenceBody` string). Populated in BOTH bases; same
   * `undefined`-vs-`null` rules as `parentBodyName`.
   */
  referenceBodyName: string | null | undefined;
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

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Wraps a degree value into [0, 360) — the Telemachus/KSP widget-facing angle convention (contrast `kepler.ts`'s internal [0, 2π) radian wrap). */
function wrapDegrees360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** `x` if finite, else `null` — the discipline every new derived scalar field in this file follows (never a NaN/Infinity escapes onto `VesselState`). */
function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/**
 * Seconds from `meanAnomaly` (radians) until the mean anomaly next reaches
 * `targetMeanAnomaly` (radians), wrapped forward to `[0, period)` — 0 when
 * already there. `null` for a non-finite or non-positive `meanMotion` (never
 * divide by zero/negative — a degenerate orbit has no well-defined period to
 * count down within).
 */
function timeToMeanAnomaly(
  meanAnomaly: number,
  targetMeanAnomaly: number,
  meanMotion: number,
): number | null {
  if (
    !Number.isFinite(meanAnomaly) ||
    !Number.isFinite(targetMeanAnomaly) ||
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    return null;
  }
  const twoPi = 2 * Math.PI;
  let delta = (targetMeanAnomaly - meanAnomaly) % twoPi;
  if (delta < 0) delta += twoPi;
  return delta / meanMotion;
}

/**
 * The apoapsis/periapsis altitude pair — needs the reference body's mean
 * radius from `system.bodies`, looked up by `orbit.referenceBodyIndex`
 * (`SystemBodyPayload.index`, the STABLE id, never array position). Kept as
 * its own function so `deriveVesselState`'s OnRails branch reads as a flat
 * list of field computations rather than an inline `system.bodies`-walking
 * block.
 *
 * `undefined` (not whole yet — "still resyncing") both when `system.bodies`
 * itself hasn't arrived and when it HAS arrived but the referenced body (or
 * its radius specifically) isn't in it yet — neither is a confirmed absence.
 * `null` only when `system.bodies` is an outright tombstone (the channel's
 * own confirmed-absent case, per the class-level `undefined`-vs-`null`
 * discipline applied here at the field level).
 */
function deriveApsides(
  get: DerivedGet,
  orbit: VesselOrbitPayload,
): {
  apoapsisAlt: number | null | undefined;
  periapsisAlt: number | null | undefined;
} {
  const bodiesPoint = get<SystemBodiesPayload>("system.bodies");
  if (!bodiesPoint) {
    return { apoapsisAlt: undefined, periapsisAlt: undefined };
  }
  if (bodiesPoint.payload === null) {
    return { apoapsisAlt: null, periapsisAlt: null };
  }

  const body = bodiesPoint.payload.bodies.find(
    (b) => b.index === orbit.referenceBodyIndex,
  );
  const radius = body?.radius;
  if (radius == null) {
    return { apoapsisAlt: undefined, periapsisAlt: undefined };
  }

  return {
    apoapsisAlt: finiteOrNull(orbit.sma * (1 + orbit.ecc) - radius),
    periapsisAlt: finiteOrNull(orbit.sma * (1 - orbit.ecc) - radius),
  };
}

/**
 * Resolve a body INDEX (the stable `SystemBodyPayload.index`, never array
 * position) to its NAME string via `system.bodies` — the client-side
 * display-map behind `vessel.state.parentBodyName`/`referenceBodyName`, the
 * new homes for the old Telemachus `v.body`/`o.referenceBody` name strings
 * (`map-topic.ts`). Mirrors `deriveApsides`'s `undefined`-vs-`null`
 * discipline:
 * - `undefined` ("still resyncing / not resolvable yet") when there's no
 *   index to resolve (`null`/`undefined` — e.g. `vessel.identity` absent, or
 *   a body with no parent), when `system.bodies` hasn't arrived, or when it
 *   HAS arrived but the referenced body (or its name specifically) isn't in
 *   it yet.
 * - `null` only when `system.bodies` is an outright tombstone — a confirmed
 *   absence.
 * Never throws on a missing index / missing table (the "not-yet-loaded" case
 * the migration task calls out explicitly).
 */
function resolveBodyName(
  get: DerivedGet,
  index: number | null | undefined,
): string | null | undefined {
  if (index == null) return undefined;
  const bodiesPoint = get<SystemBodiesPayload>("system.bodies");
  if (!bodiesPoint) return undefined;
  if (bodiesPoint.payload === null) return null;
  const body = bodiesPoint.payload.bodies.find((b) => b.index === index);
  return body?.name ?? undefined;
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
 *   position/velocity, plus `kepler.solveAnomalies(elements, viewUt)` for
 *   `period`/`trueAnomaly`/`timeToAp`/`timeToPe` (M3: derivable straight from
 *   the same elements, no extra input). `met` additionally reads
 *   `vessel.identity.launchUt`; `apoapsisAlt`/`periapsisAlt` additionally
 *   read `system.bodies` for the reference body's radius (`deriveApsides`).
 *   Both are now declared in `vesselStateChannel.inputs` (see that const's
 *   own doc comment for why growing that array is a real, deliberate,
 *   repo-wide change and not a free extra input to add lightly). `basis:
 *   "propagated"`.
 * - **Loaded** (powered/atmospheric): elements are osculating garbage for
 *   surface quantities, so altitude/vertical/surface speed come off
 *   `vessel.flight` at `viewUt` via `getInterpolated` — a straight-line lerp
 *   between the two buffered `vessel.flight` samples straddling `viewUt` (M2
 *   design §3.3/§2.4; `ClientTimeline.straddle` is the seam, `getInterpolated`
 *   is the "interpolating variant" this doc used to describe as deferred).
 *   Falls back to hold-last itself when there's nothing to straddle (e.g.
 *   only one `vessel.flight` sample so far). `basis: "measured"`.
 *
 * **`undefined` vs `null`, never conflated** (M2 design §2.1/§2.4 — this
 * task's explicit contract): no `vessel.orbit` point at-or-before `viewUt`
 * yet means the input isn't whole yet (cold start, or resynchronizing after
 * an epoch reset until the first post-reset keyframe lands) — there is no
 * quality signal to pick with, but nothing has confirmed the vessel is gone
 * either, so the whole record is `undefined` ("resynchronizing"). A
 * *tombstoned* `vessel.orbit` point (a real point whose `payload` is `null`)
 * means the vessel itself is confirmed absent, so the record is `null`.
 * Loaded quality with no `vessel.flight` point yet is `undefined` for the
 * same not-whole-yet reason; a tombstoned `vessel.flight` is `null`. Never a
 * fabricated zero-valued record either way.
 */
export function deriveVesselState(
  get: DerivedGet,
  viewUt: number,
  // Defaults to `get` (hold-last) so every pre-existing call site in this
  // file's own tests — written before `getInterpolated` existed — keeps its
  // exact prior behavior without passing a third argument.
  getInterpolated: DerivedGet = get,
): VesselState | null | undefined {
  const orbitPoint = get<VesselOrbitPayload>("vessel.orbit");
  if (!orbitPoint) return undefined; // not whole yet — no point at all
  if (orbitPoint.payload === null) return null; // tombstone — vessel confirmed absent

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
    const anomalies = solveAnomalies(elements, viewUt);

    const period = finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
    const trueAnomaly = finiteOrNull(
      wrapDegrees360(radToDeg(anomalies.trueAnomaly)),
    );
    const timeToAp = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      Math.PI,
      anomalies.meanMotion,
    );
    const timeToPe = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      0,
      anomalies.meanMotion,
    );

    // A secondary input: its own absence nulls ONLY `met`, not the whole
    // record (contrast `vessel.orbit`/`vessel.flight` above, whose absence
    // is a whole-record `undefined`/`null`) — see `VesselState.met`'s doc.
    const identityPoint = get<VesselIdentityPayload>("vessel.identity");
    const launchUt =
      identityPoint && identityPoint.payload !== null
        ? identityPoint.payload.launchUt
        : null;
    const met = launchUt == null ? null : finiteOrNull(viewUt - launchUt);

    const { apoapsisAlt, periapsisAlt } = deriveApsides(get, orbit);

    const parentBodyIndex =
      identityPoint && identityPoint.payload !== null
        ? identityPoint.payload.parentBodyIndex
        : null;
    const parentBodyName = resolveBodyName(get, parentBodyIndex);
    const referenceBodyName = resolveBodyName(get, orbit.referenceBodyIndex);

    return {
      position,
      velocity,
      altitudeAsl: null,
      verticalSpeed: null,
      surfaceSpeed: null,
      orbitalSpeed: magnitude(velocity),
      met,
      period,
      trueAnomaly,
      apoapsisAlt,
      periapsisAlt,
      timeToAp,
      timeToPe,
      parentBodyName,
      referenceBodyName,
      basis: "propagated",
      subjectId,
    };
  }

  // Loaded — orbital elements are osculating garbage here (same reasoning
  // position/velocity aren't propagated in this basis), so all seven
  // orbital-derived fields stay null rather than deriving anything from them.
  const flightPoint = getInterpolated<VesselFlightPayload>("vessel.flight");
  if (!flightPoint) return undefined; // not whole yet — no point at all
  if (flightPoint.payload === null) return null; // tombstone — vessel confirmed absent
  const flight = flightPoint.payload;

  // Body-name resolution needs only the index + the body table (no orbital
  // propagation), so it's populated in the Loaded basis too — unlike the
  // orbital-derived fields above, which stay null here (osculating garbage).
  const identityPoint = get<VesselIdentityPayload>("vessel.identity");
  const parentBodyIndex =
    identityPoint && identityPoint.payload !== null
      ? identityPoint.payload.parentBodyIndex
      : null;

  return {
    position: null,
    velocity: null,
    altitudeAsl: flight.altitudeAsl,
    verticalSpeed: flight.verticalSpeed,
    surfaceSpeed: flight.surfaceSpeed,
    orbitalSpeed: flight.orbitalSpeed,
    met: null,
    period: null,
    trueAnomaly: null,
    apoapsisAlt: null,
    periapsisAlt: null,
    timeToAp: null,
    timeToPe: null,
    parentBodyName: resolveBodyName(get, parentBodyIndex),
    referenceBodyName: resolveBodyName(get, orbit.referenceBodyIndex),
    basis: "measured",
    subjectId,
  };
}

/**
 * `vessel.state`'s own `StreamStatusValue` (M2 design §4.4: "derived
 * channels propagate the worst input staleness into their own status", T4).
 * Mirrors `deriveVesselState`'s own branching EXACTLY — worst of
 * ACTUALLY-consulted inputs, not worst of every declared input: the OnRails
 * basis never reads `vessel.flight` at all (see the "does not read
 * vessel.flight at all" test above), so a `vessel.flight` that's
 * held-stale/resyncing must not drag down an OnRails `vessel.state` reading
 * that has nothing to do with it. `getStatus`/`get` are threaded in by
 * `TimelineStore.sampleDerivedStatus` — same shape as `deriveVesselState`'s
 * own `(get, viewUt)`, plus the status lookup.
 *
 * `undefined`/`null` on the orbit input map straight onto `"resyncing"`/
 * `"absent"` — the orbit sample's OWN status already encodes exactly that
 * distinction (`sampleRawStatus`: no point at all -> `"resyncing"`,
 * tombstone -> `"absent"`), so returning it directly here reuses that
 * classification instead of re-deriving it from `get()`.
 */
export function deriveVesselStateStatus(
  getStatus: (topic: string) => StreamStatusValue,
  get: DerivedGet,
  _viewUt: number,
): StreamStatusValue {
  const orbitStatus = getStatus("vessel.orbit");
  if (orbitStatus === "resyncing" || orbitStatus === "absent") {
    return orbitStatus;
  }

  const orbitPoint = get<VesselOrbitPayload>("vessel.orbit");
  if (orbitPoint?.meta.quality === Quality.OnRails) return orbitStatus;

  // Loaded (or, defensively, an orbit point that's unexpectedly missing
  // despite a non-resyncing/absent status) — vessel.flight is consulted too.
  return worstStatus([orbitStatus, getStatus("vessel.flight")]);
}

/**
 * Ready-to-register definition — `store.registerDerivedChannel(vesselStateChannel)`.
 * `fields: true` exposes `vessel.state.<field>` subtopics (e.g.
 * `vessel.state.altitudeAsl`) reading off this one memoized record, per
 * `TimelineStore`'s field-subtopic mechanism.
 *
 * `inputs` grew to four with the M3 vessel-state-extend task
 * (`vessel.identity`/`system.bodies`, for `met`/`apoapsisAlt`/`periapsisAlt`
 * — see `deriveVesselState`'s doc). This array is NOT just documentation: the
 * M3 carried-channels gate (`carried-channels.ts`'s `isTopicCarried`, via
 * `TimelineStore.resolveSubscriptionTopics`) is PARENT-CHANNEL-scoped, not
 * per-field — a consumer of ANY `vessel.state.*` field (including the
 * already-shipped `altitudeAsl`/`orbitalSpeed`) is only "carried" once ALL
 * FOUR inputs are in its `carriedChannels` allowlist, not just the ones the
 * particular field it reads actually consults. Every existing
 * `carriedChannels` allowlist that lists `vessel.orbit`/`vessel.flight` for
 * a `vessel.state.*` read was updated alongside this change to also list
 * `vessel.identity`/`system.bodies` (harmless additions — a topic never
 * emitted on a given test's transport simply never arrives, same as any
 * other declared-but-quiet input). The alternative — leaving this array at
 * two and reading the new inputs via `get()` without declaring them — was
 * tried and rejected: it left `met`/`apoapsisAlt`/`periapsisAlt` "carried"
 * (since the gate only checks the declared two) but their extra inputs never
 * actually subscribed, so they'd read as a PERMANENT stuck `undefined`
 * instead of falling back to the still-working legacy `DataSource` read —
 * exactly the "big-bang blank-out" class of bug the carried-channels gate
 * exists to prevent (`carried-channels.ts`'s own doc comment).
 */
export const vesselStateChannel: DerivedChannelDefinition<VesselState> = {
  topic: "vessel.state",
  inputs: ["vessel.orbit", "vessel.flight", "vessel.identity", "system.bodies"],
  derive: deriveVesselState,
  deriveStatus: deriveVesselStateStatus,
  fields: true,
};
