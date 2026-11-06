import type { TopologyPart } from "@ksp-gonogo/core";
import type { DecodedPartShape } from "@ksp-gonogo/data";
import { classifyPart } from "./classifyPart";
import { shapeFitsBox } from "./meshShape";
import { partAxes, partMeshCenter } from "./shipTopology";

type Vec3 = [number, number, number];

/** A radial part is seated when its inner face is further than this from its parent's surface, in metres. */
const GAP_TOLERANCE_M = 0.02;
/** A part is radial when its origin is at least this far from its parent's axis, in metres. */
const RADIAL_MIN_OFFSET_M = 0.1;
/** The surface is read this far above and below the attach height to find its angle, in metres. */
const SLOPE_WINDOW_M = 0.15;
/** A surface leaning less than this from the parent's axis is treated as straight, in radians. */
const SLOPE_MIN_RAD = 0.026;
/** A part whose up axis is within this angle of its parent's up carries no tilt of its own on the wire, in radians. */
const UPRIGHT_TOLERANCE_RAD = 0.02;
/** The attach height must lie inside the parent's own extent by this share of it, so a part at the parent's end face is a stacked part. */
const END_FACE_MARGIN = 0.05;

/** An upright part's span is sampled this many times along its height to find the parent's widest point under it. */
const SPAN_SAMPLES = 12;

const SKIPPED_TYPES: ReadonlySet<string> = new Set([
  "strut",
  "fuel-line",
  "clamp",
  "fairing",
]);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const tuple = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

/** Rodrigues' rotation of `v` by `angle` about the unit `axis`. */
function turn(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(axis, v);
  const kd = dot(axis, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + axis[0] * kd,
    v[1] * c + kv[1] * s + axis[1] * kd,
    v[2] * c + kv[2] * s + axis[2] * kd,
  ];
}

/** The cross-section of a part's drawn meshes at a height, as the farthest reach along a direction: both in the part's own frame, metres. */
interface Profile {
  /** The farthest point of the shape's outline at height `h` along the horizontal unit direction (dx, dz), or null where the shape has nothing at that height. */
  reach(h: number, dx: number, dz: number): number | null;
  minY: number;
  maxY: number;
}

function profileOf(row: TopologyPart, shape: DecodedPartShape): Profile {
  const byMesh = new Map(row.shapePoses?.map((p) => [p.mesh, p]));
  const meshes: { points: Float32Array; indices: Uint16Array }[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of shape.meshes) {
    const pose = byMesh.get(mesh.key);
    if (!(pose ? pose.shown : mesh.shown)) continue;
    const m = pose?.transform;
    const points = new Float32Array(mesh.positions.length);
    for (let i = 0; i + 2 < points.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];
      if (m && m.length === 12) {
        points[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
        points[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
        points[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
      } else {
        points[i] = x;
        points[i + 1] = y;
        points[i + 2] = z;
      }
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
    }
    meshes.push({ points, indices: mesh.indices });
  }
  return {
    minY,
    maxY,
    reach(h, dx, dz) {
      let best: number | null = null;
      const consider = (x: number, z: number) => {
        const r = x * dx + z * dz;
        if (best === null || r > best) best = r;
      };
      for (const { points, indices } of meshes) {
        for (let t = 0; t + 2 < indices.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = indices[t + e] * 3;
            const b = indices[t + ((e + 1) % 3)] * 3;
            const ya = points[a + 1] - h;
            const yb = points[b + 1] - h;
            if (ya * yb > 0) continue;
            if (ya === yb) {
              consider(points[a], points[a + 2]);
              consider(points[b], points[b + 2]);
              continue;
            }
            const k = ya / (ya - yb);
            consider(
              points[a] + (points[b] - points[a]) * k,
              points[a + 2] + (points[b + 2] - points[a + 2]) * k,
            );
          }
        }
      }
      return best;
    },
  };
}

interface Move {
  /** Added to every part of the subtree after it has been turned. */
  shift: Vec3;
  /** The turn applied to the subtree about the seated part's origin, or null for none. */
  axis: Vec3 | null;
  angle: number;
}

/** Half the extent of a part's box along a vessel-frame direction. */
function halfExtentAlong(row: TopologyPart, dir: Vec3): number {
  const axes = partAxes(row);
  const size = row.bounds.size;
  return (
    (size.x / 2) * Math.abs(dot(tuple(axes.right), dir)) +
    (size.y / 2) * Math.abs(dot(tuple(axes.up), dir)) +
    (size.z / 2) * Math.abs(dot(tuple(axes.forward), dir))
  );
}

function applyMove(
  rows: Map<number, TopologyPart>,
  ids: readonly number[],
  pivot: Vec3,
  move: Move,
) {
  for (const id of ids) {
    const row = rows.get(id);
    if (!row) continue;
    const axes = partAxes(row);
    let org = tuple({
      x: row.orgPos[0],
      y: row.orgPos[1],
      z: row.orgPos[2],
    });
    let up = tuple(axes.up);
    let forward = tuple(axes.forward);
    if (move.axis) {
      org = add(pivot, turn(sub(org, pivot), move.axis, move.angle));
      up = turn(up, move.axis, move.angle);
      forward = turn(forward, move.axis, move.angle);
    }
    org = add(org, move.shift);
    rows.set(
      id,
      move.axis
        ? { ...row, orgPos: org, up, forward }
        : { ...row, orgPos: org },
    );
  }
}

/**
 * Seats each radially mounted part against its parent's surface, as the game
 * attaches it. The wire carries no attach point, so a radial part is one whose
 * origin lies off its parent's axis within the parent's own height; the
 * parent's outline at that height comes from its 3D shape.
 *
 * A part standing clear of that outline is moved in along its radial
 * direction until its inner face touches; an upright part touches at the
 * parent's widest point over its own height. A parachute (the part carries a
 * parachute module) whose up axis the wire leaves parallel to its parent's is
 * turned so its up runs along the surface where the outline leans, on the
 * sloped side of a command pod leaning with it. Every other part keeps the
 * orientation the wire gives it. Everything mounted on a seated part moves
 * with it, and turns with it when it is turned.
 *
 * A part that is not radial, a parent whose shape has not arrived or does not
 * fill its box, and struts, fuel lines, clamps and fairings are left as they
 * are, and so is a part already touching or sunk into its parent.
 */
export function seatRadialParts(
  parts: readonly TopologyPart[],
  shapeOf: (shape: string) => DecodedPartShape | undefined,
): readonly TopologyPart[] {
  const rows = new Map(parts.map((p) => [p.flightId, p]));
  const children = new Map<number, number[]>();
  for (const p of parts) {
    if (p.parentFlightId == null || !rows.has(p.parentFlightId)) continue;
    const list = children.get(p.parentFlightId) ?? [];
    list.push(p.flightId);
    children.set(p.parentFlightId, list);
  }
  const profiles = new Map<number, Profile | null>();
  const profileFor = (row: TopologyPart): Profile | null => {
    if (profiles.has(row.flightId)) return profiles.get(row.flightId) ?? null;
    const shape = row.shape ? shapeOf(row.shape) : undefined;
    const usable =
      shape && shapeFitsBox(shape, row.bounds.size, row.shapePoses)
        ? profileOf(row, shape)
        : null;
    profiles.set(row.flightId, usable);
    return usable;
  };
  const subtreeOf = (id: number): number[] => {
    const out = [id];
    for (let i = 0; i < out.length; i++) {
      out.push(...(children.get(out[i]) ?? []));
    }
    return out;
  };

  const queue = parts
    .filter((p) => p.parentFlightId == null || !rows.has(p.parentFlightId))
    .map((p) => p.flightId);
  let changed = false;
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    queue.push(...(children.get(id) ?? []));
    const child = rows.get(id);
    const parent =
      child?.parentFlightId != null ? rows.get(child.parentFlightId) : null;
    if (!child || !parent) continue;
    const type = classifyPart(child, undefined);
    if (SKIPPED_TYPES.has(type)) continue;
    const profile = profileFor(parent);
    if (!profile) continue;

    const pAxes = partAxes(parent);
    const pUp = tuple(pAxes.up);
    const pOrg: Vec3 = [parent.orgPos[0], parent.orgPos[1], parent.orgPos[2]];
    const origin: Vec3 = [child.orgPos[0], child.orgPos[1], child.orgPos[2]];
    const rel = sub(origin, pOrg);
    const h = dot(rel, pUp);
    const across = sub(rel, scale(pUp, h));
    const offset = Math.hypot(across[0], across[1], across[2]);
    if (offset < RADIAL_MIN_OFFSET_M) continue;
    const margin = (profile.maxY - profile.minY) * END_FACE_MARGIN;
    if (h < profile.minY + margin || h > profile.maxY - margin) continue;

    const dir = scale(across, 1 / offset);
    const dx = dot(dir, tuple(pAxes.right));
    const dz = dot(dir, tuple(pAxes.forward));
    const attachReach = profile.reach(h, dx, dz);
    if (attachReach === null) continue;

    let move: Move = { shift: [0, 0, 0], axis: null, angle: 0 };
    let seated = child;

    const cAxes = partAxes(child);
    const upright = Math.acos(
      Math.max(-1, Math.min(1, dot(tuple(cAxes.up), pUp))),
    );
    const window = SLOPE_WINDOW_M;
    const above = profile.reach(h + window, dx, dz);
    const below = profile.reach(h - window, dx, dz);
    const slope =
      above !== null && below !== null ? (above - below) / (2 * window) : 0;
    if (
      type === "parachute" &&
      upright < UPRIGHT_TOLERANCE_RAD &&
      Math.atan(Math.abs(slope)) > SLOPE_MIN_RAD
    ) {
      const lean = add(scale(dir, slope), pUp);
      const len = Math.hypot(lean[0], lean[1], lean[2]);
      const along = scale(lean, 1 / len);
      const axis = cross(pUp, along);
      const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
      if (axisLen > 1e-9) {
        move = {
          shift: [0, 0, 0],
          axis: scale(axis, 1 / axisLen),
          angle: Math.asin(Math.min(1, axisLen)),
        };
        const turned = new Map(rows);
        applyMove(turned, [id], origin, move);
        seated = turned.get(id) ?? child;
      }
    }

    const centre = partMeshCenter(seated);
    let surface = attachReach;
    if (!move.axis) {
      /* An upright part meets a sloped parent at the parent's widest point under it, so the part clears the outline over its whole height. */
      const centreHeight = dot(sub(centre, pOrg), pUp);
      const half = halfExtentAlong(seated, pUp);
      for (let k = 0; k <= SPAN_SAMPLES; k++) {
        const at = centreHeight - half + (2 * half * k) / SPAN_SAMPLES;
        const reach = profile.reach(at, dx, dz);
        if (reach !== null && reach > surface) surface = reach;
      }
    }
    const face = dot(sub(centre, pOrg), dir) - halfExtentAlong(seated, dir);
    const gap = face - surface;
    if (gap > GAP_TOLERANCE_M) move = { ...move, shift: scale(dir, -gap) };
    if (!move.axis && gap <= GAP_TOLERANCE_M) continue;

    applyMove(rows, subtreeOf(id), origin, move);
    changed = true;
  }
  return changed ? parts.map((p) => rows.get(p.flightId) ?? p) : parts;
}
