/**
 * Maneuver preset solvers — pure functions over Keplerian elements.
 *
 * All solvers return a `ManeuverPlan` with ΔV components (prograde, normal,
 * radial) in m/s, an absolute UT for the burn, and a projected post-burn
 * orbit for preview. No side effects, no data-source access — call sites
 * feed in a `CurrentOrbit` snapshot and μ (gravitational parameter).
 *
 * μ availability: KSP body μ isn't carried on BodyDefinition, so derive it
 * from live telemetry with `gravParameterFromState(v, r, a)` — the
 * vis-viva equation gives an exact answer from any point on the orbit.
 *
 * Frame convention: ΔV components are in Telemachus's maneuver-node frame
 * — prograde along velocity, radial along +r̂ (outward from body), normal
 * perpendicular to the orbital plane. The projected-orbit math handles
 * arbitrary flight-path angle; plane change from a non-zero normal is
 * carried through but not reflected in the projected in-plane shape.
 */

import { eccentricToTrueAnomaly, solveKepler } from "./trajectory";

/** Orbit snapshot taken from Telemachus `o.*` keys. All distances in metres. */
export interface CurrentOrbit {
  /** Semi-major axis. */
  sma: number;
  /** Eccentricity [0, 1). */
  eccentricity: number;
  /** Apoapsis distance from body centre. */
  ApR: number;
  /** Periapsis distance from body centre. */
  PeR: number;
  /** Seconds until vessel reaches apoapsis. */
  timeToAp: number;
  /** Seconds until vessel reaches periapsis. */
  timeToPe: number;
}

/** Resulting orbit shape after a maneuver — for preview, not execution. */
export interface ProjectedOrbit {
  sma: number;
  eccentricity: number;
  ApR: number;
  PeR: number;
  /** Seconds. */
  period: number;
  /** Degrees. Present for plane-change presets; omitted otherwise. */
  inclination?: number;
}

export interface ManeuverPlan {
  /** Absolute UT for the burn (seconds). */
  ut: number;
  /** ΔV along the velocity vector (m/s). Positive raises, negative lowers. */
  prograde: number;
  /** ΔV perpendicular to the orbital plane (m/s). */
  normal: number;
  /** ΔV along the radius (m/s). Positive is outward from the body. */
  radial: number;
  /** Magnitude `√(p² + n² + r²)`. */
  requiredDeltaV: number;
  /** In-plane projected orbit after the burn, or null if inputs are invalid. */
  projected: ProjectedOrbit | null;
}

/**
 * A multi-burn plan — used by Hohmann presets (transfer-to-altitude is
 * two burns; rendezvous-with-target adds an optional plane-match burn
 * up front). Each entry is a fully-formed `ManeuverPlan` so the widget
 * commits them sequentially via the same code path as single-burn
 * presets.
 */
export interface ManeuverSequence {
  burns: ManeuverPlan[];
  /** Sum of `Math.abs(burn.requiredDeltaV)` across all burns (m/s). */
  totalDeltaV: number;
  /** Orbit shape after the LAST burn — what the vessel ends up on. */
  finalProjected: ProjectedOrbit | null;
  /**
   * For Hohmann transfers, the elliptic orbit between burn 1 and burn 2.
   * Same shape as `burns[0].projected`, exposed separately so callers can
   * style it differently in previews.
   */
  transferEllipse: ProjectedOrbit | null;
}

export type Apsis = "apo" | "peri";

// ---------------------------------------------------------------------------
// Vis-viva helpers
// ---------------------------------------------------------------------------

/**
 * Gravitational parameter μ (m³/s²) derived from a single point on an orbit.
 * Uses vis-viva rearranged: `μ = v²·a·r / (2a − r)`. Any point works; the
 * easiest is the current vessel position from live telemetry.
 */
export function gravParameterFromState(
  orbitalSpeed: number,
  radius: number,
  sma: number,
): number {
  const denom = 2 * sma - radius;
  if (!(denom > 0)) return 0;
  return (orbitalSpeed * orbitalSpeed * sma * radius) / denom;
}

/** Vis-viva: speed at radius `r` on an orbit with semi-major axis `a`. */
function speedAt(mu: number, r: number, a: number): number {
  return Math.sqrt(mu * (2 / r - 1 / a));
}

/** Circular-orbit speed at radius `r`. */
function circularSpeed(mu: number, r: number): number {
  return Math.sqrt(mu / r);
}

function periodAt(mu: number, sma: number): number {
  if (!(sma > 0)) return 0;
  return 2 * Math.PI * Math.sqrt((sma * sma * sma) / mu);
}

/**
 * Shape of the post-burn orbit given an in-plane state at the burn point.
 * Decomposes the pre-burn velocity into horizontal + radial components
 * using the flight-path angle, adds the ΔV (prograde along velocity +
 * radial along +r̂), then derives the new sma/ecc from specific energy
 * and angular momentum. Normal components are the caller's responsibility
 * — they tilt the plane without reshaping the in-plane orbit.
 *
 * Returns null when the burn puts the vessel on an escape / parabolic
 * trajectory (non-negative specific energy) — V1 previews only support
 * elliptic post-burn orbits.
 */
function projectBurn(
  r: number,
  vPre: number,
  gamma: number,
  mu: number,
  prograde: number,
  radial: number,
): ProjectedOrbit | null {
  // Pre-burn velocity in (horizontal, radial) frame. "Horizontal" is in
  // the orbital plane, perpendicular to the radius vector.
  const cosG = Math.cos(gamma);
  const sinG = Math.sin(gamma);

  // Prograde ΔV lies along the pre-burn velocity direction (cosG, sinG).
  // Radial ΔV lies along +r̂ = (0, 1) in the (h, r) frame.
  const vH = vPre * cosG + prograde * cosG;
  const vR = vPre * sinG + prograde * sinG + radial;

  const vMag = Math.hypot(vH, vR);
  if (!Number.isFinite(vMag)) return null;

  const epsilon = (vMag * vMag) / 2 - mu / r;
  if (epsilon >= 0) return null;
  const newSma = -mu / (2 * epsilon);

  // Angular momentum per unit mass = r × v; only the horizontal velocity
  // component contributes.
  const h = r * vH;
  const e2 = 1 + (2 * epsilon * h * h) / (mu * mu);
  const newEcc = Math.sqrt(Math.max(0, e2));

  return {
    sma: newSma,
    eccentricity: newEcc,
    ApR: newSma * (1 + newEcc),
    PeR: newSma * (1 - newEcc),
    period: periodAt(mu, newSma),
  };
}

/**
 * Analytically propagate a point on a Keplerian orbit to an arbitrary UT.
 * Returns scalar in-plane state at the target UT — enough to feed
 * `projectBurn`. Does not attempt SOI transitions; burns that cross a
 * patch boundary need `trajectory.patchStateAt` on the right patch
 * instead.
 */
export function stateAtUT(
  current: CurrentOrbit,
  currentTrueAnomalyDeg: number,
  mu: number,
  currentUT: number,
  targetUT: number,
): {
  r: number;
  speed: number;
  flightPathAngle: number;
  trueAnomalyDeg: number;
} {
  const a = current.sma;
  const e = current.eccentricity;

  // Current true anomaly → eccentric anomaly.
  const nu0 = (currentTrueAnomalyDeg * Math.PI) / 180;
  const E0 =
    2 *
    Math.atan2(
      Math.sqrt(1 - e) * Math.sin(nu0 / 2),
      Math.sqrt(1 + e) * Math.cos(nu0 / 2),
    );
  // Mean anomaly propagates linearly with time.
  const M0 = E0 - e * Math.sin(E0);
  const n = Math.sqrt(mu / (a * a * a));
  const M = M0 + n * (targetUT - currentUT);

  const E = solveKepler(M, e);
  const nu = eccentricToTrueAnomaly(E, e);

  const r = a * (1 - e * Math.cos(E));
  const speed = Math.sqrt(mu * (2 / r - 1 / a));
  // γ from local horizontal: tan(γ) = e·sin(ν) / (1 + e·cos(ν)).
  const flightPathAngle = Math.atan2(e * Math.sin(nu), 1 + e * Math.cos(nu));
  return {
    r,
    speed,
    flightPathAngle,
    trueAnomalyDeg: ((nu * 180) / Math.PI + 360) % 360,
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Circularise the orbit at apoapsis. Pure prograde burn; ΔV is the
 * difference between the current apoapsis speed and the circular speed
 * at that radius.
 */
export function circularizeAtApo(
  current: CurrentOrbit,
  mu: number,
  currentUT: number,
): ManeuverPlan {
  const r = current.ApR;
  const vCurrent = speedAt(mu, r, current.sma);
  const vTarget = circularSpeed(mu, r);
  const prograde = vTarget - vCurrent;
  return {
    ut: currentUT + current.timeToAp,
    prograde,
    normal: 0,
    radial: 0,
    requiredDeltaV: Math.abs(prograde),
    projected: {
      sma: r,
      eccentricity: 0,
      ApR: r,
      PeR: r,
      period: periodAt(mu, r),
    },
  };
}

/** Circularise at periapsis. Mirror of {@link circularizeAtApo}. */
export function circularizeAtPeri(
  current: CurrentOrbit,
  mu: number,
  currentUT: number,
): ManeuverPlan {
  const r = current.PeR;
  const vCurrent = speedAt(mu, r, current.sma);
  const vTarget = circularSpeed(mu, r);
  const prograde = vTarget - vCurrent;
  return {
    ut: currentUT + current.timeToPe,
    prograde,
    normal: 0,
    radial: 0,
    requiredDeltaV: Math.abs(prograde),
    projected: {
      sma: r,
      eccentricity: 0,
      ApR: r,
      PeR: r,
      period: periodAt(mu, r),
    },
  };
}

/**
 * Arbitrary ΔV components burned at the next apoapsis or periapsis.
 * All three components (prograde/normal/radial) are carried through to the
 * plan so the widget can commit them; the projected orbit reflects
 * prograde + radial only (the normal component tilts the plane and doesn't
 * reshape the in-plane orbit at an apsis).
 */
export function customAtApsis(
  current: CurrentOrbit,
  mu: number,
  currentUT: number,
  apsis: Apsis,
  prograde: number,
  normal: number,
  radial: number,
): ManeuverPlan {
  const r = apsis === "apo" ? current.ApR : current.PeR;
  const dt = apsis === "apo" ? current.timeToAp : current.timeToPe;
  // At an apsis γ = 0 by definition — velocity is perpendicular to radius.
  const vPre = speedAt(mu, r, current.sma);
  const projected = projectBurn(r, vPre, 0, mu, prograde, radial);
  return {
    ut: currentUT + dt,
    prograde,
    normal,
    radial,
    requiredDeltaV: Math.hypot(prograde, normal, radial),
    projected,
  };
}

/**
 * Arbitrary ΔV at an arbitrary UT. Propagates the current orbit to the
 * burn point with `stateAtUT` so the projected shape reflects the real
 * flight-path angle at that point (unlike the apsis presets which assume
 * γ = 0). `currentTrueAnomalyDeg` is Telemachus's `o.trueAnomaly` at
 * `currentUT`.
 *
 * If `burnUT <= currentUT`, projected is null — we can't plan a burn in
 * the past.
 */
export function customAtUT(
  current: CurrentOrbit,
  currentTrueAnomalyDeg: number,
  mu: number,
  currentUT: number,
  burnUT: number,
  prograde: number,
  normal: number,
  radial: number,
): ManeuverPlan {
  if (burnUT <= currentUT) {
    return {
      ut: burnUT,
      prograde,
      normal,
      radial,
      requiredDeltaV: Math.hypot(prograde, normal, radial),
      projected: null,
    };
  }
  const { r, speed, flightPathAngle } = stateAtUT(
    current,
    currentTrueAnomalyDeg,
    mu,
    currentUT,
    burnUT,
  );
  const projected = projectBurn(
    r,
    speed,
    flightPathAngle,
    mu,
    prograde,
    radial,
  );
  return {
    ut: burnUT,
    prograde,
    normal,
    radial,
    requiredDeltaV: Math.hypot(prograde, normal, radial),
    projected,
  };
}

// ---------------------------------------------------------------------------
// Plane-change presets
// ---------------------------------------------------------------------------

/**
 * True anomaly of the ascending / descending node for the current orbit,
 * both in degrees in [0, 360). `argumentOfPeriapsis` is the angle from the
 * ascending node to periapsis, so the AN itself sits at ν = -argPe and
 * the DN at ν = 180° - argPe (mod 360°).
 */
function nodeAnomalies(argumentOfPeriapsisDeg: number): {
  an: number;
  dn: number;
} {
  const mod360 = (x: number) => ((x % 360) + 360) % 360;
  return {
    an: mod360(-argumentOfPeriapsisDeg),
    dn: mod360(180 - argumentOfPeriapsisDeg),
  };
}

/**
 * Time from `currentTrueAnomalyDeg` forward to `targetTrueAnomalyDeg` on
 * the same orbit, in seconds. Always returns a non-negative value — if
 * the target is "behind" us, we wait for the next pass.
 */
function timeToTrueAnomaly(
  current: CurrentOrbit,
  currentTrueAnomalyDeg: number,
  targetTrueAnomalyDeg: number,
  mu: number,
): number {
  const a = current.sma;
  const e = current.eccentricity;
  const n = Math.sqrt(mu / (a * a * a));
  const period = (2 * Math.PI) / n;

  const toM = (trueAnomalyDeg: number) => {
    const nu = (trueAnomalyDeg * Math.PI) / 180;
    const E =
      2 *
      Math.atan2(
        Math.sqrt(1 - e) * Math.sin(nu / 2),
        Math.sqrt(1 + e) * Math.cos(nu / 2),
      );
    return E - e * Math.sin(E);
  };

  const dM = toM(targetTrueAnomalyDeg) - toM(currentTrueAnomalyDeg);
  let dt = dM / n;
  // Wrap forward if the target has already passed this orbit.
  while (dt < 0) dt += period;
  return dt;
}

/**
 * Match a target inclination by burning normal at the next ascending or
 * descending node (whichever is sooner). Preserves the in-plane orbit
 * shape — we only rotate the plane around the node line, which is the
 * cheapest kind of inclination change.
 *
 * `currentInclinationDeg` / `targetInclinationDeg` are absolute
 * inclinations from the body's equator (matching `o.inclination`). The
 * result's `normal` is signed: positive at an AN burn increases
 * inclination, negative decreases it — and vice-versa at the DN, so
 * "where are we?" is folded into the sign for us here.
 */
export function matchInclination(
  current: CurrentOrbit,
  currentTrueAnomalyDeg: number,
  currentArgumentOfPeriapsisDeg: number,
  currentInclinationDeg: number,
  mu: number,
  currentUT: number,
  targetInclinationDeg: number,
): ManeuverPlan {
  const nodes = nodeAnomalies(currentArgumentOfPeriapsisDeg);
  const dtAN = timeToTrueAnomaly(current, currentTrueAnomalyDeg, nodes.an, mu);
  const dtDN = timeToTrueAnomaly(current, currentTrueAnomalyDeg, nodes.dn, mu);

  // Burn at whichever node arrives first. At AN a +normal burn rotates
  // the orbit's angular-momentum vector northward → higher inclination;
  // at DN the geometry is mirrored, so the sign flips.
  const useAN = dtAN <= dtDN;
  const dt = useAN ? dtAN : dtDN;
  const nodeDirection = useAN ? 1 : -1;

  const burnUT = currentUT + dt;
  const state = stateAtUT(
    current,
    currentTrueAnomalyDeg,
    mu,
    currentUT,
    burnUT,
  );

  // Cheap plane-change formula: normal ΔV magnitude is 2·v_h·sin(Δi/2),
  // where v_h is the velocity component in the plane perpendicular to
  // the radius (i.e. horizontal). At a node γ is approximately zero for
  // circular-ish orbits, but we include the cos(γ) correction for
  // eccentric cases.
  const deltaIRad =
    ((targetInclinationDeg - currentInclinationDeg) * Math.PI) / 180;
  const vHorizontal = state.speed * Math.cos(state.flightPathAngle);
  const magnitude = 2 * vHorizontal * Math.sin(Math.abs(deltaIRad) / 2);
  const normal = nodeDirection * Math.sign(deltaIRad) * magnitude;

  return {
    ut: burnUT,
    prograde: 0,
    normal,
    radial: 0,
    requiredDeltaV: Math.abs(normal),
    projected: {
      sma: current.sma,
      eccentricity: current.eccentricity,
      ApR: current.ApR,
      PeR: current.PeR,
      period: periodAt(mu, current.sma),
      inclination: targetInclinationDeg,
    },
  };
}

/**
 * Match the full orbital plane of a target — both inclination AND LAN.
 * Burns at the intersection line of the two planes, which in general
 * is NOT the current orbit's equatorial AN/DN. Uses the relative
 * angular-momentum geometry:
 *
 *   cos(θ_rel) = cos(i₁)·cos(i₂) + sin(i₁)·sin(i₂)·cos(Ω₂ − Ω₁)
 *
 * and the standard spherical-trig formula for the argument of latitude
 * `u₁` on orbit 1 where it crosses orbit 2's plane. ΔV = 2·v_h·sin(θ_rel/2),
 * applied normal.
 *
 * Result's projected inclination is the target's — after a pure plane
 * change at the node, we lie in orbit 2's plane exactly.
 */
export function matchTargetPlane(
  current: CurrentOrbit,
  currentTrueAnomalyDeg: number,
  currentArgumentOfPeriapsisDeg: number,
  currentInclinationDeg: number,
  currentLanDeg: number,
  targetInclinationDeg: number,
  targetLanDeg: number,
  mu: number,
  currentUT: number,
): ManeuverPlan {
  const i1 = (currentInclinationDeg * Math.PI) / 180;
  const i2 = (targetInclinationDeg * Math.PI) / 180;
  const dOmega = ((targetLanDeg - currentLanDeg) * Math.PI) / 180;

  const cosRel =
    Math.cos(i1) * Math.cos(i2) +
    Math.sin(i1) * Math.sin(i2) * Math.cos(dOmega);
  const relIncRad = Math.acos(Math.max(-1, Math.min(1, cosRel)));

  // Argument of latitude on orbit 1 where it crosses orbit 2's plane
  // going "up" relative to orbit 2. Standard spherical trig — see any
  // orbital-mechanics reference on relative AN / DN between two orbits.
  const u1Rad = Math.atan2(
    Math.sin(i2) * Math.sin(dOmega),
    Math.cos(i1) * Math.sin(i2) * Math.cos(dOmega) -
      Math.sin(i1) * Math.cos(i2),
  );
  const u1Deg = ((u1Rad * 180) / Math.PI + 360) % 360;
  // argPe is the angle from our AN to periapsis, so true anomaly at the
  // relative node is u₁ − argPe.
  const nuAN = (((u1Deg - currentArgumentOfPeriapsisDeg) % 360) + 360) % 360;
  const nuDN = (nuAN + 180) % 360;

  const dtAN = timeToTrueAnomaly(current, currentTrueAnomalyDeg, nuAN, mu);
  const dtDN = timeToTrueAnomaly(current, currentTrueAnomalyDeg, nuDN, mu);
  const useAN = dtAN <= dtDN;
  const dt = useAN ? dtAN : dtDN;
  const nodeDirection = useAN ? 1 : -1;

  const burnUT = currentUT + dt;
  const state = stateAtUT(
    current,
    currentTrueAnomalyDeg,
    mu,
    currentUT,
    burnUT,
  );

  const vHorizontal = state.speed * Math.cos(state.flightPathAngle);
  const magnitude = 2 * vHorizontal * Math.sin(relIncRad / 2);
  const normal = nodeDirection * magnitude;

  return {
    ut: burnUT,
    prograde: 0,
    normal,
    radial: 0,
    requiredDeltaV: Math.abs(normal),
    projected: {
      sma: current.sma,
      eccentricity: current.eccentricity,
      ApR: current.ApR,
      PeR: current.PeR,
      period: periodAt(mu, current.sma),
      inclination: targetInclinationDeg,
    },
  };
}

/**
 * Two-burn Hohmann transfer to a circular orbit at radius `targetR`
 * (distance from body centre, metres).
 *
 * Burn 1 happens at the chosen apsis of the current orbit (γ = 0 there,
 * so a pure prograde burn cleanly reshapes the in-plane ellipse). It puts
 * the vessel on a transfer ellipse whose far apsis sits at `targetR`.
 *
 * Burn 2 happens half a transfer period later, when the vessel reaches
 * `targetR`. Pure prograde again, circularising the orbit.
 *
 * `fromApsis` selects which apsis to start at. Omit it for the default
 * heuristic: `peri` when the target is at or above the current SMA
 * (raising), `apo` when below (lowering). For an elliptical current orbit
 * with `targetR` between PeR and ApR the heuristic still produces a
 * valid sequence — the transfer ellipse just overlaps the current orbit.
 *
 * Returns null when `targetR <= 0`, `mu <= 0`, or the current SMA is
 * non-positive.
 */
export function hohmannToRadius(
  current: CurrentOrbit,
  mu: number,
  currentUT: number,
  targetR: number,
  fromApsis?: Apsis,
): ManeuverSequence | null {
  if (!(targetR > 0) || !(mu > 0) || !(current.sma > 0)) return null;

  const apsis: Apsis = fromApsis ?? (targetR >= current.sma ? "peri" : "apo");
  const r1 = apsis === "apo" ? current.ApR : current.PeR;
  const dt1 = apsis === "apo" ? current.timeToAp : current.timeToPe;
  if (!(r1 > 0)) return null;

  const transferSma = (r1 + targetR) / 2;
  if (!(transferSma > 0)) return null;

  // Burn 1: at r1, prograde adjusts to transfer-ellipse speed at that radius.
  const v1Pre = speedAt(mu, r1, current.sma);
  const v1Post = speedAt(mu, r1, transferSma);
  const dv1 = v1Post - v1Pre;
  const burn1UT = currentUT + dt1;

  const transferApR = Math.max(r1, targetR);
  const transferPeR = Math.min(r1, targetR);
  const sumApPe = transferApR + transferPeR;
  const transferEcc = sumApPe > 0 ? (transferApR - transferPeR) / sumApPe : 0;
  const transferPeriod = periodAt(mu, transferSma);
  const transferEllipse: ProjectedOrbit = {
    sma: transferSma,
    eccentricity: transferEcc,
    ApR: transferApR,
    PeR: transferPeR,
    period: transferPeriod,
  };

  // Burn 2: half a transfer period later, at r2 = targetR. Circularise.
  const v2Pre = speedAt(mu, targetR, transferSma);
  const v2Post = circularSpeed(mu, targetR);
  const dv2 = v2Post - v2Pre;
  const burn2UT = burn1UT + transferPeriod / 2;

  const finalProjected: ProjectedOrbit = {
    sma: targetR,
    eccentricity: 0,
    ApR: targetR,
    PeR: targetR,
    period: periodAt(mu, targetR),
  };

  const burn1: ManeuverPlan = {
    ut: burn1UT,
    prograde: dv1,
    normal: 0,
    radial: 0,
    requiredDeltaV: Math.abs(dv1),
    projected: transferEllipse,
  };
  const burn2: ManeuverPlan = {
    ut: burn2UT,
    prograde: dv2,
    normal: 0,
    radial: 0,
    requiredDeltaV: Math.abs(dv2),
    projected: finalProjected,
  };

  return {
    burns: [burn1, burn2],
    totalDeltaV: Math.abs(dv1) + Math.abs(dv2),
    finalProjected,
    transferEllipse,
  };
}

/**
 * State of the target needed for a Hohmann rendezvous calc. All angles
 * in degrees, distances in metres. Maps directly to Telemachus's
 * `tar.o.sma`, `tar.o.PeR` (= PeA + bodyRadius), `tar.o.inclination`,
 * `tar.o.lan`, `tar.o.argumentOfPeriapsis`, `tar.o.trueAnomaly`,
 * `tar.o.period`.
 */
export interface TargetOrbitState {
  sma: number;
  PeR: number;
  inclinationDeg: number;
  lanDeg: number;
  argPeDeg: number;
  trueAnomalyDeg: number;
  period: number;
}

/**
 * Two- or three-burn Hohmann transfer to rendezvous with a target.
 *
 * Burn structure:
 *   - If relative-plane mismatch > 0.5°, prepend a plane-match burn at
 *     the next relative-plane AN/DN (delegates to `matchTargetPlane`).
 *   - Two prograde burns: raise/lower vessel orbit to a circle at the
 *     target's periapsis radius (`target.PeR`); time burn 1 so vessel
 *     arrives at the target's periapsis position the same UT the target
 *     reaches periapsis, offset by `standoffMeters` along-track on the
 *     target's orbit (positive = arrive that far behind the target).
 *
 * Approximations and limits:
 *   - Vessel orbit treated as approximately circular at `vessel.sma`.
 *     Burn-1 ΔV is exact only for circular orbits; for `vessel.eccentricity
 *     > ~0.05` it's approximate.
 *   - Rendezvous radius is the target's periapsis. After the second burn
 *     the vessel is on a circle at `target.PeR`; the target is on its
 *     eccentric orbit and will separate immediately. Closest approach is
 *     at the meeting moment.
 *   - Phase angle is computed from `LAN + argPe + ν` for both bodies,
 *     which is the projection onto the orbital plane that matches when
 *     they're coplanar. Pre-plane-match this is an approximation; it
 *     gets exact once the plane-match burn aligns the two planes.
 *
 * Returns null on degenerate inputs (μ ≤ 0, target.PeR ≤ 0, resonant
 * orbits where the synodic period is unbounded, etc.).
 */
export function hohmannRendezvous(
  vessel: CurrentOrbit,
  vesselTrueAnomalyDeg: number,
  vesselArgPeDeg: number,
  vesselInclinationDeg: number,
  vesselLanDeg: number,
  mu: number,
  currentUT: number,
  target: TargetOrbitState,
  standoffMeters: number,
): ManeuverSequence | null {
  if (!(mu > 0)) return null;
  if (!(target.PeR > 0)) return null;
  if (!(target.sma > 0)) return null;
  if (!(vessel.sma > 0)) return null;

  // 1. Plane-mismatch detection — cos(rel) formula matches matchTargetPlane.
  const i1 = (vesselInclinationDeg * Math.PI) / 180;
  const i2 = (target.inclinationDeg * Math.PI) / 180;
  const dOmegaRad = ((target.lanDeg - vesselLanDeg) * Math.PI) / 180;
  const cosRel =
    Math.cos(i1) * Math.cos(i2) +
    Math.sin(i1) * Math.sin(i2) * Math.cos(dOmegaRad);
  const relIncRad = Math.acos(Math.max(-1, Math.min(1, cosRel)));
  const relIncDeg = (relIncRad * 180) / Math.PI;

  const PLANE_MATCH_THRESHOLD_DEG = 0.5;
  const burns: ManeuverPlan[] = [];
  let effectiveStartUT = currentUT;

  if (relIncDeg > PLANE_MATCH_THRESHOLD_DEG) {
    const planeMatch = matchTargetPlane(
      vessel,
      vesselTrueAnomalyDeg,
      vesselArgPeDeg,
      vesselInclinationDeg,
      vesselLanDeg,
      target.inclinationDeg,
      target.lanDeg,
      mu,
      currentUT,
    );
    burns.push(planeMatch);
    if (planeMatch.ut > effectiveStartUT) effectiveStartUT = planeMatch.ut;
  }

  // 2. Phase-angle math. Treat both orbits as circular at SMA for the
  // closing-rate calc; the rendezvous *radius* is target.PeR (where the
  // target spends the most predictable moment of its orbit).
  const r1 = vessel.sma;
  const r2 = target.PeR;
  const transferSma = (r1 + r2) / 2;
  if (!(transferSma > 0)) return null;
  const transferPeriod = periodAt(mu, transferSma);
  const transferHalfPeriod = transferPeriod / 2;

  const omegaVessel = Math.sqrt(mu / (r1 * r1 * r1));
  const omegaTarget = Math.sqrt(mu / (target.sma * target.sma * target.sma));
  const dPhiDt = omegaTarget - omegaVessel;
  if (Math.abs(dPhiDt) < 1e-12) return null; // resonant — never aligns

  // Lead angle: target should be `leadAngle` ahead of vessel at burn 1
  // so it walks 180° − leadAngle while vessel transfers half an orbit
  // round to the same point. Standoff > 0 → arrive `standoffMeters`
  // behind the target → leadAngle grows by standoff arc-length / r2.
  const standoffArc = standoffMeters / r2;
  const TWO_PI = 2 * Math.PI;
  let leadAngle = Math.PI - omegaTarget * transferHalfPeriod + standoffArc;
  leadAngle = ((leadAngle % TWO_PI) + TWO_PI) % TWO_PI;

  // True longitude (planar projection): LAN + argPe + ν (deg → rad).
  // Exact when both orbits share a plane; approximate otherwise.
  const vesselTrueLongDeg =
    vesselLanDeg + vesselArgPeDeg + vesselTrueAnomalyDeg;
  const targetTrueLongDeg =
    target.lanDeg + target.argPeDeg + target.trueAnomalyDeg;
  let phiNow = ((targetTrueLongDeg - vesselTrueLongDeg) * Math.PI) / 180;
  phiNow = ((phiNow % TWO_PI) + TWO_PI) % TWO_PI;

  // Drift from currentUT to effectiveStartUT (zero if no plane match).
  const phiAtStart = phiNow + dPhiDt * (effectiveStartUT - currentUT);

  // Wait for φ to reach leadAngle, going in the direction dictated by dPhiDt.
  // We always normalise the angular delta to [0, 2π) and divide by |dPhiDt|;
  // sign of dPhiDt only picks the rotation direction, not the wait length.
  const deltaSigned =
    dPhiDt > 0 ? leadAngle - phiAtStart : phiAtStart - leadAngle;
  const deltaNormalised = ((deltaSigned % TWO_PI) + TWO_PI) % TWO_PI;
  const waitTime = deltaNormalised / Math.abs(dPhiDt);
  const burn1UT = effectiveStartUT + waitTime;

  // 3. Hohmann burns. Vessel as circular at r1, target circle at r2.
  const v1Pre = circularSpeed(mu, r1);
  const v1Post = speedAt(mu, r1, transferSma);
  const dv1 = v1Post - v1Pre;

  const burn2UT = burn1UT + transferHalfPeriod;
  const v2Pre = speedAt(mu, r2, transferSma);
  const v2Post = circularSpeed(mu, r2);
  const dv2 = v2Post - v2Pre;

  const transferApR = Math.max(r1, r2);
  const transferPeR = Math.min(r1, r2);
  const sumApPe = transferApR + transferPeR;
  const transferEcc = sumApPe > 0 ? (transferApR - transferPeR) / sumApPe : 0;
  const transferEllipse: ProjectedOrbit = {
    sma: transferSma,
    eccentricity: transferEcc,
    ApR: transferApR,
    PeR: transferPeR,
    period: transferPeriod,
  };
  const finalProjected: ProjectedOrbit = {
    sma: r2,
    eccentricity: 0,
    ApR: r2,
    PeR: r2,
    period: periodAt(mu, r2),
  };

  burns.push({
    ut: burn1UT,
    prograde: dv1,
    normal: 0,
    radial: 0,
    requiredDeltaV: Math.abs(dv1),
    projected: transferEllipse,
  });
  burns.push({
    ut: burn2UT,
    prograde: dv2,
    normal: 0,
    radial: 0,
    requiredDeltaV: Math.abs(dv2),
    projected: finalProjected,
  });

  const totalDeltaV = burns.reduce((sum, b) => sum + b.requiredDeltaV, 0);

  return {
    burns,
    totalDeltaV,
    finalProjected,
    transferEllipse,
  };
}
