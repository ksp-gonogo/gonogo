import type {
  PartResources,
  PartState,
  PartStateModule,
  PartThermal,
  TopologyPart,
} from "@ksp-gonogo/core";
import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { MeterTone } from "@ksp-gonogo/ui-kit";
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
  /** Prefab bounds in metres: `{x, y, z}` from `v.topology.parts[].bounds.size`. */
  size: { x: number; y: number; z: number };
  /** Half-extent along the picked lateral axis, in metres. */
  latHalfExtent: number;
  /** Half-extent along the spine, in metres. */
  axialHalfExtent: number;
  /** `Part.mass` from topology: dry mass, no resources. */
  dryMass: number;
  /** `Part.inverseStage` from topology. */
  stage: number;
  /** Internal-part max temperature (K) from topology. */
  maxTemp: number;
  /** Live temperature in Kelvin from `therm.part[flightId]`, if available. */
  temperatureK?: number;
  /** Live max temperature in Kelvin. */
  maxTemperatureK?: number;
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

/**
 * One resource meter for a part, aggregated from the `ship-map.part-meters`
 * contribution slot. The built-in contribution and any Uplink's emit this
 * same shape, and which resource earns a meter is the contributor's call.
 * The fill colour is the resource's identity (`resourceColor(resource)`),
 * independent of `status`, so a contributor never picks a colour.
 */
export interface ShipMapPartMeterEntry {
  /** `ShipMapPart.flightId`, stringified: entries travel the slot store as plain data. */
  partId: string;
  /** Resource name as on `vessel.parts` (e.g. "LiquidFuel"). At most one entry per (partId, resource). */
  resource: string;
  /** Human label; falls back to `resource`. */
  displayName: string;
  /** Current stored amount, as a quantity or the whole `Reading` of one, so the `Meter` can mark currency and band. */
  amount: Value<"units"> | Reading<Value<"units">>;
  /** Max storage capacity, same terms as `amount`. A non-positive capacity drops the entry. */
  capacity: Value<"units"> | Reading<Value<"units">>;
  /**
   * A status signal separate from the fill hue: `"low"`/`"critical"` draw a
   * border tint or badge; `null`/`undefined` is healthy. The contributor owns
   * its own thresholds.
   */
  status?: "low" | "critical" | null;
}

/**
 * One per-part status row for the `ship-map.part-meta` slot: things about a
 * part that are not a fill level.
 */
export interface ShipMapPartMetaEntry {
  /** `ShipMapPart.flightId`, stringified (see `ShipMapPartMeterEntry.partId`). */
  partId: string;
  /** Short label, e.g. "Water Recycler". At most one entry per (partId, label). */
  label: string;
  tone: MeterTone;
  /** "ratio": a 0..1 reading rendered as a `<Meter>`. "text": a free-form status row. */
  kind: "ratio" | "text";
  /** Present when `kind === "ratio"`. */
  value?: number;
  /** Present when `kind === "text"`. */
  text?: string;
}

/** Normalise `r.resourceFor` output into the diagram's `{n, a, c}` shape, dropping zero-capacity resources. */
export function normaliseResources(
  resources: PartResources | undefined,
): ShipMapPart["resources"] {
  if (!resources) return undefined;
  const out: { n: string; a: number; c: number }[] = [];
  for (const [name, slot] of Object.entries(resources)) {
    if (!slot || slot.maxAmount <= 0) continue;
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

/**
 * Rotate a part-local vector into the vessel frame by the minimal swing
 * taking +Y onto `up` (`orgRot * Vector3.up`, the only rotation on the wire),
 * via the trig-free `v + k x v + (k x (k x v)) / (1 + cos)` form. No `up`, or
 * a zero one, is the identity. An exactly inverted part is a half-turn about
 * X, since the closed form divides by zero there.
 */
function rotateIntoVesselFrame(
  v: { x: number; y: number; z: number },
  up: readonly [number, number, number] | undefined,
): { x: number; y: number; z: number } {
  if (!up) return v;
  const len = Math.hypot(up[0], up[1], up[2]);
  if (len < 1e-9) return v;
  const bx = up[0] / len;
  const by = up[1] / len;
  const bz = up[2] / len;
  // cos of the swing angle: dot((0,1,0), up).
  const cos = by;
  if (cos > 1 - 1e-12) return v;
  if (cos < -1 + 1e-12) return { x: v.x, y: -v.y, z: -v.z };
  // k = (0,1,0) x up.
  const kx = bz;
  const kz = -bx;
  // k x v, with k.y identically zero.
  const c1x = -kz * v.y;
  const c1y = kz * v.x - kx * v.z;
  const c1z = kx * v.y;
  // k x (k x v), same shortcut.
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
 * Build a `ShipMapPart` from one topology entry and the live slice. The
 * caller picks the lateral axis once per vessel via `pickLateralAxis`.
 */
export function buildShipMapPart(
  part: TopologyPart,
  thermal: PartThermal | null | undefined,
  resources: PartResources | undefined,
  useX: boolean,
  partState?: PartState | null,
  parentOrgPos?: readonly [number, number, number] | null,
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
  /* Rotation is `atan2(lateral, axial)` from screen-up. When both projected components are near zero the part points along the depth axis, where atan2 flips on the sign of -0, so it renders unrotated. */
  const up = part.up;
  const upLat = up ? (useX ? up[0] : up[2]) : 0;
  const upAxial = up ? up[1] : 1;
  const projectedMagSq = upLat * upLat + upAxial * upAxial;
  const rotationRad = projectedMagSq < 0.01 ? 0 : Math.atan2(upLat, upAxial);
  /*
   * Mesh-centre offset, rotated into the vessel frame before it is added to
   * `orgPos` (the attach-node anchor). `bounds.center` is part-local. Only the
   * swing onto `up` is recoverable, so the twist about `up` is not, and a
   * lateral offset can land on the wrong side of its mount.
   */
  const center = part.bounds.center;
  const meshOffset = center
    ? rotateIntoVesselFrame(center, up)
    : { x: 0, y: 0, z: 0 };
  const meshLat =
    (useX ? orgPos[0] : orgPos[2]) + (useX ? meshOffset.x : meshOffset.z);
  const meshDepth =
    (useX ? orgPos[2] : orgPos[0]) + (useX ? meshOffset.z : meshOffset.x);
  const meshAxial = orgPos[1] + meshOffset.y;
  const type = classifyPart(part, resources);
  /* Flat radial plates (solar panels, fins) are foreshortened by how face-on they are, from their azimuth relative to the parent (not the root). Assumes the ring convention: a panel's thin axis faces radially, a fin's tangentially. */
  let latHalfExtent = (useX ? size.x : size.z) / 2;
  if (type === "solar" || type === "fin") {
    const parentLat = parentOrgPos
      ? useX
        ? parentOrgPos[0]
        : parentOrgPos[2]
      : 0;
    const parentDepth = parentOrgPos
      ? useX
        ? parentOrgPos[2]
        : parentOrgPos[0]
      : 0;
    const pickedPos = (useX ? orgPos[0] : orgPos[2]) - parentLat;
    const depthPos = (useX ? orgPos[2] : orgPos[0]) - parentDepth;
    const radius = Math.hypot(pickedPos, depthPos);
    if (radius > 0.05) {
      // A panel's broad face is tangential and a fin's is radial, so they swap which extent rides which direction.
      const broad = Math.max(size.x, size.z);
      const thin = Math.min(size.x, size.z);
      const ru = Math.abs(pickedPos / radius);
      const rd = Math.abs(depthPos / radius);
      // A fin's radial factor is squared so angled fins read clearly shorter; the extremes are unchanged.
      latHalfExtent =
        type === "fin"
          ? (broad / 2) * ru * ru + (thin / 2) * rd
          : (broad / 2) * rd + (thin / 2) * ru;
    }
  }
  return {
    flightId: part.flightId,
    parentFlightId: part.parentFlightId,
    name: part.name,
    title: part.title,
    type,
    lat: meshLat,
    axial: meshAxial,
    depth: meshDepth,
    rotationRad,
    size,
    latHalfExtent,
    axialHalfExtent: size.y / 2,
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
