import type {
  PartResources,
  PartState,
  PartStateModule,
  PartThermal,
  TopologyPart,
} from "@ksp-gonogo/core";
import { classifyPart } from "./classifyPart";

/** Diagram-side categories: one per visually distinct shape. Every other KSP category is "other". */
export type PartType =
  | "engine"
  | "booster"
  | "tank"
  | "decoupler"
  | "nose-cone"
  | "fin"
  | "rcs"
  | "capsule"
  | "solar"
  | "parachute"
  | "wheel"
  | "fuel-line"
  | "other";

/**
 * Flattened per-part view consumed by `<ShipDiagram>`: static topology plus
 * whatever live data has landed. Live fields are optional.
 */
export interface ShipMapPart {
  flightId: number;
  parentFlightId: number | null;
  name: string;
  title: string;
  type: PartType;
  /** Position component along the picked lateral axis (x or y). */
  lat: number;
  /** Position along the spine (orgPos z). */
  axial: number;
  /** Position along the collapsed depth axis. Not drawn, but parts are painted back-to-front by it. */
  depth: number;
  /**
   * Screen-space CCW rotation in radians, from the part's `up` vector
   * projected into the diagram plane (axial to screen-up, lateral to
   * screen-right). 0 when `up` is absent.
   */
  rotationRad: number;
  /** The part's mesh box in metres, in its own frame: `bounds.size` from the topology. */
  size: { x: number; y: number; z: number };
  /** Half-width of the part's box in the diagram, across its projected up direction, in metres. */
  latHalfExtent: number;
  /** Half-height of the part's box in the diagram, along its projected up direction, in metres. */
  axialHalfExtent: number;
  /** `Part.mass` from topology: dry mass, no resources. Null when unread. */
  dryMass: number | null;
  /** `Part.inverseStage` from topology. Null when unread. */
  stage: number | null;
  /** Internal-part max temperature (K) from topology. Null when unread. */
  maxTemp: number | null;
  /** Live temperature in Kelvin from `therm.part[flightId]`, if available. */
  temperatureK?: number;
  /** Live max temperature in Kelvin, null when unread. */
  maxTemperatureK?: number | null;
  /** Live resources, normalised to the `{n, a, c}` triplet the fuel-fill bars use. */
  resources?: { n: string; a: number; c: number }[];
  /** Net ElectricCharge flow sign on this part; `null` when it has no live EC flow. */
  ecFlowSign?: "producer" | "consumer" | null;
  /** The destination tank's flightId for a fuel-line part. */
  fuelLineTarget?: number | null;
  /**
   * Per-module behavioural state (deploy, activation). Empty when the part has
   * no behavioural modules; undefined before any `vessel.parts` payload, which
   * means unknown, not all retracted.
   */
  partState?: PartStateModule[];
}

export type {
  ShipMapPartMetaEntry,
  ShipMapPartMeterEntry,
} from "@ksp-gonogo/sitrep-sdk";

/** Normalise `r.resourceFor` output into the diagram's `{n, a, c}` shape, dropping zero-capacity resources. */
export function normaliseResources(
  resources: PartResources | undefined,
): ShipMapPart["resources"] {
  if (!resources) return undefined;
  const out: { n: string; a: number; c: number }[] = [];
  for (const [name, slot] of Object.entries(resources)) {
    // A tank whose figures could not be read has no fill to draw.
    if (
      !slot ||
      slot.amount == null ||
      slot.maxAmount == null ||
      slot.maxAmount <= 0
    )
      continue;
    out.push({ n: name, a: slot.amount, c: slot.maxAmount });
  }
  return out;
}

/**
 * Pick whichever lateral axis (X or Z) has the wider spread, so the side view
 * shows the silhouette rather than edge-on. Y is the vessel's spine.
 */
export function pickLateralAxis(parts: readonly TopologyPart[]): {
  useX: boolean;
} {
  if (parts.length === 0) return { useX: true };
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of parts) {
    const [x, , z] = p.orgPos;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  return { useX: xMax - xMin >= zMax - zMin };
}

type Vec3 = { x: number; y: number; z: number };

/** The vessel-frame images of the part's local X, Y and Z axes: the columns of its rotation. */
interface PartAxes {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

const IDENTITY_AXES: PartAxes = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: 1 },
};

function unit(v: readonly [number, number, number]): Vec3 | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return null;
  return { x: v[0] / len, y: v[1] / len, z: v[2] / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Rotate a part-local vector by the minimal swing taking +Y onto `up`, via
 * the trig-free `v + k x v + (k x (k x v)) / (1 + cos)` form. An exactly
 * inverted part is a half-turn about X, since the closed form divides by
 * zero there.
 */
function swing(v: Vec3, up: Vec3): Vec3 {
  const cos = up.y;
  if (cos > 1 - 1e-12) return v;
  if (cos < -1 + 1e-12) return { x: v.x, y: -v.y, z: -v.z };
  // k = (0,1,0) x up, so k.y is identically zero.
  const kx = up.z;
  const kz = -up.x;
  const c1x = -kz * v.y;
  const c1y = kz * v.x - kx * v.z;
  const c1z = kx * v.y;
  const c2x = -kz * c1y;
  const c2y = kz * c1x - kx * c1z;
  const c2z = kx * c1y;
  const s = 1 / (1 + cos);
  return {
    x: v.x + c1x + c2x * s,
    y: v.y + c1y + c2y * s,
    z: v.z + c1z + c2z * s,
  };
}

/**
 * The part's rotation in the vessel frame from its `up` and `forward` axes.
 * With `up` alone the roll about it is unknown, so the minimal swing onto
 * `up` stands in for it; with neither the part is unrotated.
 */
function partAxes(part: TopologyPart): PartAxes {
  const up = part.up ? unit(part.up) : null;
  if (!up) return IDENTITY_AXES;
  const forward = part.forward ? unit(part.forward) : null;
  if (!forward) {
    return {
      right: swing(IDENTITY_AXES.right, up),
      up,
      forward: swing(IDENTITY_AXES.forward, up),
    };
  }
  // KSP's frame is left-handed, where right = up x forward with the ordinary cross product.
  return { right: cross(up, forward), up, forward };
}

function rotate(axes: PartAxes, v: Vec3): Vec3 {
  return {
    x: axes.right.x * v.x + axes.up.x * v.y + axes.forward.x * v.z,
    y: axes.right.y * v.x + axes.up.y * v.y + axes.forward.y * v.z,
    z: axes.right.z * v.x + axes.up.z * v.y + axes.forward.z * v.z,
  };
}

/**
 * Build a `ShipMapPart` from one topology entry and the live slice. The
 * caller picks the lateral axis once per vessel via `pickLateralAxis`.
 */
export function buildShipMapPart(
  part: TopologyPart,
  thermal: PartThermal | null | undefined,
  resources: PartResources | undefined,
  useX: boolean,
  partState?: PartState | null,
): ShipMapPart {
  const orgPos = part.orgPos;
  const ecFlow = resources?.ElectricCharge?.flow;
  const ecFlowSign: "producer" | "consumer" | null =
    typeof ecFlow === "number" && Math.abs(ecFlow) > 1e-6
      ? ecFlow > 0
        ? "producer"
        : "consumer"
      : null;
  const size = part.bounds.size;
  const axes = partAxes(part);
  const latOf = (v: Vec3) => (useX ? v.x : v.z);
  const depthOf = (v: Vec3) => (useX ? v.z : v.x);
  /* Rotation is `atan2(lateral, axial)` from screen-up. When both projected components are near zero the part points along the depth axis, where atan2 flips on the sign of -0, so it renders unrotated. */
  const upLat = latOf(axes.up);
  const upAxial = axes.up.y;
  const rotationRad =
    upLat * upLat + upAxial * upAxial < 0.01 ? 0 : Math.atan2(upLat, upAxial);
  // `bounds.center` is part-local, so it turns with the part before it is added to `orgPos`.
  const center = part.bounds.center ?? { x: 0, y: 0, z: 0 };
  const meshOffset = rotate(axes, center);
  /*
   * The box is drawn upright and then turned by `rotationRad`, so its height
   * runs along the projected up direction and its width across it. Each
   * extent is the half-width of the part's rotated box measured along that
   * screen direction, which is exact for the box's silhouette in this view.
   */
  const sin = Math.sin(rotationRad);
  const cos = Math.cos(rotationRad);
  const halfExtentAlong = (dLat: number, dAxial: number) =>
    (size.x / 2) * Math.abs(dLat * latOf(axes.right) + dAxial * axes.right.y) +
    (size.y / 2) * Math.abs(dLat * latOf(axes.up) + dAxial * axes.up.y) +
    (size.z / 2) *
      Math.abs(dLat * latOf(axes.forward) + dAxial * axes.forward.y);
  const type = classifyPart(part, resources);
  return {
    flightId: part.flightId,
    parentFlightId: part.parentFlightId,
    name: part.name,
    title: part.title,
    type,
    lat: (useX ? orgPos[0] : orgPos[2]) + latOf(meshOffset),
    axial: orgPos[1] + meshOffset.y,
    depth: (useX ? orgPos[2] : orgPos[0]) + depthOf(meshOffset),
    rotationRad,
    size,
    latHalfExtent: halfExtentAlong(cos, -sin),
    axialHalfExtent: halfExtentAlong(sin, cos),
    dryMass: part.dryMass,
    stage: part.inverseStage,
    maxTemp: part.maxTemp,
    temperatureK: thermal?.temperatureK,
    maxTemperatureK: thermal?.maxTemperatureK,
    resources: normaliseResources(resources),
    ecFlowSign,
    fuelLineTarget: part.fuelLineTarget ?? null,
    partState: partState?.modules,
  };
}
