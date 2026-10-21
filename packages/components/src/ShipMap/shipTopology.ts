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
  /** Landing legs and landing gear: a strut with a foot, since the mesh box also holds the folded strut. */
  | "gear"
  | "fuel-line"
  /** A docking port: a collar at the end of a part, not a stage separator. */
  | "docking-port"
  /** A structural strut: a link between two parts, whose mesh box is the unstretched model and says nothing of the link. */
  | "strut"
  /** A closed fairing: a shell over the parts it covers, drawn last so they show through it. */
  | "fairing"
  /** Launch clamps: pad towers that fall away at liftoff, drawn as a faint outline rather than a part. */
  | "clamp"
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
  /**
   * For a wing or fin drawn from its planform: which side of the drawn box,
   * before the part's rotation, the tip is on (1 right, -1 left). Absent for a
   * part that is not a plate, which is drawn as a plain box.
   */
  tipSign?: 1 | -1;
  /**
   * For a landing leg or gear with its strut folded away: the stowed strut
   * as a capsule, in metres in the drawn box's frame (x across, y up the
   * box, from the box centre). Absent when the part is not a thin strut
   * (a wheel folded into a bay), which is drawn as the outline of its box.
   */
  stowedStrut?: StowedStrut;
  /** For a structural strut: where it attaches, in metres in the drawn box's frame from the box centre. */
  anchor?: { x: number; y: number };
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

/** A folded leg's strut: a capsule of diameter `width` between two points, in metres in the drawn box's frame (x across, y up). */
export interface StowedStrut {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
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

/** The vessel-frame centre of the part's mesh box: its origin plus the box's own offset, turned by the part's rotation. */
export function partMeshCenter(part: TopologyPart): [number, number, number] {
  const axes = partAxes(part);
  const offset = rotate(axes, part.bounds.center ?? { x: 0, y: 0, z: 0 });
  return [
    part.orgPos[0] + offset.x,
    part.orgPos[1] + offset.y,
    part.orgPos[2] + offset.z,
  ];
}

/** The lateral component of a vessel-frame vector in a view turned `view` radians about the spine. */
export function lateralOf(v: Vec3, view: number): number {
  return v.x * Math.cos(view) + v.z * Math.sin(view);
}

/** The depth component, along the view direction, of a vessel-frame vector in a view turned `view` radians about the spine. */
export function depthOf(v: Vec3, view: number): number {
  return -v.x * Math.sin(view) + v.z * Math.cos(view);
}

/** A folded strut is thin when its thinnest side is under this share of its middle side. */
const STOWED_STRUT_THINNESS = 0.5;

/**
 * The strut of a folded landing leg inside its mesh box. The leg is a stick
 * lying in the plane of the box's two longest sides, hinged at the part's
 * origin, so it runs corner to corner from the one nearest the origin; its
 * thickness is the third side. A capsule of that diameter fits the box when
 * its ends sit half a diameter in from the corners. Null when the thinnest
 * side is not much thinner than the middle one, which is a wheel in its bay.
 * Points are returned in part-local metres from the box centre.
 */
function stowedStrutLocal(
  size: Vec3,
  centre: Vec3,
): { from: Vec3; to: Vec3; width: number } | null {
  const sides = (["x", "y", "z"] as const)
    .map((axis) => ({ axis, size: size[axis] }))
    .sort((a, b) => b.size - a.size);
  const [long, middle, thin] = sides;
  if (thin.size > middle.size * STOWED_STRUT_THINNESS) return null;
  const from: Vec3 = { x: 0, y: 0, z: 0 };
  const to: Vec3 = { x: 0, y: 0, z: 0 };
  for (const side of [long, middle]) {
    const lo = centre[side.axis] - side.size / 2;
    const hi = centre[side.axis] + side.size / 2;
    // The face nearer the origin is where the leg is hinged.
    const [near, far] = Math.abs(lo) <= Math.abs(hi) ? [lo, hi] : [hi, lo];
    const inset = Math.min(thin.size / 2, side.size / 2);
    const toward = Math.sign(far - near);
    from[side.axis] = near + toward * inset - centre[side.axis];
    to[side.axis] = far - toward * inset - centre[side.axis];
  }
  return { from, to, width: thin.size };
}

interface Planform {
  rotationRad: number;
  tipSign: 1 | -1;
}

/** A chord whose axial share of its length is under this lies across the screen. */
const CHORD_ACROSS_SCREEN = 0.1;
/** A plate counts as a wing when its thin side is under this share of its next longest side. */
const PLATE_THICKNESS_RATIO = 0.35;
/** The root edge sits at the part's origin when the box centre is offset from it by at least this share of the span. */
const ROOT_OFFSET_SHARE = 0.1;
/** Two sides differ in how far the origin sits from their middle by at least this much to name the span. */
const SPAN_OFFSET_MARGIN = 0.15;

/**
 * The drawn frame of a wing or fin: a plate seen in its own planform. The thin
 * side is the plate's normal; of the other two, the span is the one whose
 * middle lies furthest from the part's origin (the root), and the chord the
 * other. The drawn box is turned so its screen-up is the chord's leading
 * direction, the way the craft's nose points, and the tip is on the side the
 * span runs away from the root. Null for a part that is not a plate.
 */
function planformOf(
  part: TopologyPart,
  axes: PartAxes,
  view: number,
  partLat: number,
): Planform | null {
  const size = part.bounds.size;
  const offset = part.bounds.center ?? { x: 0, y: 0, z: 0 };
  const sides = [
    { dir: axes.right, size: size.x, mid: offset.x },
    { dir: axes.up, size: size.y, mid: offset.y },
    { dir: axes.forward, size: size.z, mid: offset.z },
  ].sort((a, b) => a.size - b.size);
  const [thin, first, second] = sides;
  if (thin.size > second.size * PLATE_THICKNESS_RATIO || second.size < 1e-6) {
    return null;
  }
  const rootness = (s: { size: number; mid: number }) =>
    Math.abs(s.mid) / Math.max(s.size, 1e-6);
  const project = (dir: Vec3) => ({ lat: lateralOf(dir, view), axial: dir.y });
  const outward = partLat >= 0 ? 1 : -1;
  let span = first;
  let chord = second;
  const offsetGap = rootness(second) - rootness(first);
  const secondIsSpan =
    Math.abs(offsetGap) > SPAN_OFFSET_MARGIN
      ? offsetGap > 0
      : Math.abs(project(second.dir).lat) > Math.abs(project(first.dir).lat);
  if (secondIsSpan) {
    span = second;
    chord = first;
  }
  const spanDir = project(span.dir);
  const chordDir = project(chord.dir);
  const spanSign =
    rootness(span) >= ROOT_OFFSET_SHARE
      ? Math.sign(span.mid)
      : spanDir.lat * outward >= 0
        ? 1
        : -1;
  const tip = { lat: spanDir.lat * spanSign, axial: spanDir.axial * spanSign };
  // The nose is screen-up, so the leading edge is the chord's side that points up it; a chord lying across the screen has no such side, and takes the outboard one so a mirrored pair stays mirrored.
  const leadSign =
    Math.abs(chordDir.axial) > CHORD_ACROSS_SCREEN
      ? Math.sign(chordDir.axial)
      : chordDir.lat * outward >= 0
        ? 1
        : -1;
  const lead = {
    lat: chordDir.lat * leadSign,
    axial: chordDir.axial * leadSign,
  };
  const chordLength = Math.hypot(lead.lat, lead.axial);
  const rotationRad = chordLength < 0.1 ? 0 : Math.atan2(lead.lat, lead.axial);
  const rightLat = Math.cos(rotationRad);
  const rightAxial = -Math.sin(rotationRad);
  const along = tip.lat * rightLat + tip.axial * rightAxial;
  return {
    rotationRad,
    tipSign: along >= 0 ? 1 : -1,
  };
}

/**
 * Build a `ShipMapPart` from one topology entry and the live slice. The
 * caller picks the view once per vessel (`pickView`, turned by the operator's
 * rotation): the angle in radians about the spine at which the diagram looks
 * at the craft, 0 putting the vessel's X axis across the screen.
 */
export function buildShipMapPart(
  part: TopologyPart,
  thermal: PartThermal | null | undefined,
  resources: PartResources | undefined,
  view: number,
  partState?: PartState | null,
): ShipMapPart {
  const ecFlow = resources?.ElectricCharge?.flow;
  const ecFlowSign: "producer" | "consumer" | null =
    typeof ecFlow === "number" && Math.abs(ecFlow) > 1e-6
      ? ecFlow > 0
        ? "producer"
        : "consumer"
      : null;
  const size = part.bounds.size;
  const axes = partAxes(part);
  const latOf = (v: Vec3) => lateralOf(v, view);
  /* Rotation is `atan2(lateral, axial)` from screen-up. When both projected components are near zero the part points along the depth axis, where atan2 flips on the sign of -0, so it renders unrotated. */
  const upLat = latOf(axes.up);
  const upAxial = axes.up.y;
  const upRotation =
    upLat * upLat + upAxial * upAxial < 0.01 ? 0 : Math.atan2(upLat, upAxial);
  // `bounds.center` is part-local, so it turns with the part before it is added to `orgPos`.
  const meshCentre = partMeshCenter(part);
  const lat = lateralOf(
    { x: meshCentre[0], y: meshCentre[1], z: meshCentre[2] },
    view,
  );
  const type = classifyPart(part, resources);
  const planform = type === "fin" ? planformOf(part, axes, view, lat) : null;
  const rotationRad = planform?.rotationRad ?? upRotation;
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
  /* A point in the part's own frame, relative to its box centre, as a position in the drawn box's frame: turned into the diagram plane, then back through the part's own on-screen rotation. */
  const inBoxFrame = (local: Vec3) => {
    const v = rotate(axes, local);
    const screenLat = latOf(v);
    return {
      x: screenLat * cos - v.y * sin,
      y: screenLat * sin + v.y * cos,
    };
  };
  const centre = part.bounds.center ?? { x: 0, y: 0, z: 0 };
  const stowed = type === "gear" ? stowedStrutLocal(size, centre) : null;
  let stowedStrut: StowedStrut | undefined;
  if (stowed) {
    const from = inBoxFrame(stowed.from);
    const to = inBoxFrame(stowed.to);
    stowedStrut = {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      width: stowed.width,
    };
  }
  const anchor =
    type === "strut"
      ? inBoxFrame({ x: -centre.x, y: -centre.y, z: -centre.z })
      : undefined;
  return {
    flightId: part.flightId,
    parentFlightId: part.parentFlightId,
    name: part.name,
    title: part.title,
    type,
    lat,
    axial: meshCentre[1],
    depth: depthOf(
      { x: meshCentre[0], y: meshCentre[1], z: meshCentre[2] },
      view,
    ),
    rotationRad,
    size,
    latHalfExtent: halfExtentAlong(cos, -sin),
    axialHalfExtent: halfExtentAlong(sin, cos),
    tipSign: planform?.tipSign,
    stowedStrut,
    anchor,
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
