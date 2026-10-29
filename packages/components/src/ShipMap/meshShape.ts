import type { TopologyPart } from "@ksp-gonogo/core";
import type { DecodedPartShape, DecodedPartShapeMesh } from "@ksp-gonogo/data";

/**
 * A 3 by 4 affine map, row by row: a point `(x, y, z)` goes to
 * `(m0 x + m1 y + m2 z + m3, m4 x + m5 y + m6 z + m7, m8 x + m9 y + m10 z + m11)`.
 */
export type Affine = readonly number[];

/** The moved or switched meshes of one part, as its topology row carries them. */
export type ShapePoses = NonNullable<TopologyPart["shapePoses"]>;

/**
 * The direction light comes from, fixed on the screen: from the upper left and
 * toward the operator, with x across to the right, y up and z out of the
 * screen. Unit length.
 */
export const SCREEN_LIGHT: readonly [number, number, number] = (() => {
  const v = [-0.45, 0.65, 0.6];
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len] as const;
})();

/** How many tones a face's light is rounded to. The middle tone is the part's own colour. */
export const TONE_STEPS = 5;

/** Two faces meeting at more than this angle between their normals draw a line along the edge they share. */
export const CREASE_ANGLE_DEG = 40;
const CREASE_COS = Math.cos((CREASE_ANGLE_DEG * Math.PI) / 180);

/** A patch of faces that share a tone and touch edge to edge, outlined in the drawn box's frame. */
export interface ShapeRegion {
  /** Closed outlines as flat x, y lists in metres, outer ones anticlockwise with y up and holes clockwise. */
  loops: number[][];
  /** Area-weighted mean depth toward the viewer, metres from the box centre. */
  depth: number;
  /** The light tone, 0 darkest to `TONE_STEPS - 1` lightest. */
  tone: number;
}

/** One mesh as seen from one place. */
export interface MeshView {
  /** The outline of every face seen, as `ShapeRegion.loops` are drawn. */
  outline: number[][];
  regions: ShapeRegion[];
  /** Every face seen, as x, y, z for each of its three corners. */
  triangles: Float64Array;
  /** The index in `regions` of each face in `triangles`. */
  triangleRegion: Int32Array;
  /** Sharp edges, the open edges of a sheet and the edges where a surface turns away, as flat x1, y1, z1, x2, y2, z2 lists. */
  creases: number[];
}

/** A part's shape ready to draw: SVG path data in metres in the drawn box's frame, y up. */
export interface ShapeDrawing {
  /** The outline of everything seen of the part, filled together as its silhouette. Empty when nothing of the part shows. */
  outline: string;
  /** Lit patches in paint order, each path one tone, so a nearer patch covers a farther one. */
  faces: { tone: number; d: string }[];
  /**
   * The edges not hidden behind the part's own faces where faces meet at
   * more than `CREASE_ANGLE_DEG`, where a sheet ends, and where a surface
   * turns away from the viewer.
   */
  creases: string;
}

interface MeshTopology {
  /** The first vertex at each vertex's position, so faces split at a texture seam still touch. */
  weld: Int32Array;
  /** Per face corner `3t + e`: the face across edge `e` (corner `e` to corner `e + 1`), or -1 for an open or overloaded edge. */
  across: Int32Array;
  /** Per face: 1 when the loose piece it belongs to has no open edge, so its far side is never seen. */
  closed: Uint8Array;
  /** Per face: 1 when two of its corners sit at the same place. */
  degenerate: Uint8Array;
}

const topologies = new WeakMap<DecodedPartShapeMesh, MeshTopology>();

/** Which faces touch which, and which loose pieces are closed, for one mesh: the same from every side and in every pose. */
function meshTopology(mesh: DecodedPartShapeMesh): MeshTopology {
  const kept = topologies.get(mesh);
  if (kept) return kept;
  const { positions, indices } = mesh;
  const points = positions.length / 3;
  const weld = new Int32Array(points);
  const firstAt = new Map<string, number>();
  for (let i = 0; i < points; i++) {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    const first = firstAt.get(key);
    if (first === undefined) {
      firstAt.set(key, i);
      weld[i] = i;
    } else {
      weld[i] = first;
    }
  }
  const faces = indices.length / 3;
  const across = new Int32Array(faces * 3).fill(-1);
  const degenerate = new Uint8Array(faces);
  const cornersOn = new Map<number, number[]>();
  for (let t = 0; t < faces; t++) {
    const a = weld[indices[t * 3]];
    const b = weld[indices[t * 3 + 1]];
    const c = weld[indices[t * 3 + 2]];
    if (a === b || b === c || c === a) {
      degenerate[t] = 1;
      continue;
    }
    const corners = [a, b, c];
    for (let e = 0; e < 3; e++) {
      const u = corners[e];
      const v = corners[(e + 1) % 3];
      const key = u < v ? u * 65536 + v : v * 65536 + u;
      const list = cornersOn.get(key);
      if (list) list.push(t * 3 + e);
      else cornersOn.set(key, [t * 3 + e]);
    }
  }
  // An edge joins two faces only when exactly two share it; one with three or more is open to all of them.
  for (const list of cornersOn.values()) {
    if (list.length !== 2) continue;
    across[list[0]] = Math.floor(list[1] / 3);
    across[list[1]] = Math.floor(list[0] / 3);
  }
  const closed = closedPieces(across, degenerate);
  const topology = { weld, across, closed, degenerate };
  topologies.set(mesh, topology);
  return topology;
}

/** Marks each face whose loose piece, the faces it reaches edge to edge, has no open edge. */
function closedPieces(across: Int32Array, degenerate: Uint8Array): Uint8Array {
  const faces = degenerate.length;
  const piece = new Int32Array(faces).fill(-1);
  const open: boolean[] = [];
  const stack: number[] = [];
  for (let start = 0; start < faces; start++) {
    if (piece[start] !== -1 || degenerate[start]) continue;
    const id = open.length;
    open.push(false);
    piece[start] = id;
    stack.push(start);
    while (stack.length) {
      const t = stack.pop() as number;
      for (let e = 0; e < 3; e++) {
        const u = across[t * 3 + e];
        if (u === -1) {
          open[id] = true;
          continue;
        }
        if (piece[u] !== -1) continue;
        piece[u] = id;
        stack.push(u);
      }
    }
  }
  const closed = new Uint8Array(faces);
  for (let t = 0; t < faces; t++) {
    if (piece[t] !== -1 && !open[piece[t]]) closed[t] = 1;
  }
  return closed;
}

/** `outer` applied after `inner`. */
export function composeAffine(outer: Affine, inner: Affine): number[] {
  const out = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let sum =
        outer[r * 4] * inner[c] +
        outer[r * 4 + 1] * inner[4 + c] +
        outer[r * 4 + 2] * inner[8 + c];
      if (c === 3) sum += outer[r * 4 + 3];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

function determinant(m: Affine): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[1] * (m[4] * m[10] - m[6] * m[8]) +
    m[2] * (m[4] * m[9] - m[5] * m[8])
  );
}

/**
 * One mesh seen through `frame`, which carries its points into the drawn
 * box's frame (x across, y up, z toward the viewer), lit from `light` in that
 * same frame.
 *
 * A face toward the viewer is drawn and takes a tone from how squarely it
 * meets the light. A face turned away is dropped when its loose piece is
 * closed, since the near side covers it; on an open sheet it is drawn as its
 * other side. Faces of one tone that touch edge to edge merge into one patch,
 * outlined by the edges they do not share.
 */
export function viewMesh(
  mesh: DecodedPartShapeMesh,
  frame: Affine,
  light: readonly [number, number, number],
): MeshView {
  const { weld, across, closed, degenerate } = meshTopology(mesh);
  const { positions, indices } = mesh;
  const points = positions.length / 3;
  const xs = new Float64Array(points);
  const ys = new Float64Array(points);
  const zs = new Float64Array(points);
  for (let i = 0; i < points; i++) {
    if (weld[i] !== i) continue;
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    xs[i] = frame[0] * x + frame[1] * y + frame[2] * z + frame[3];
    ys[i] = frame[4] * x + frame[5] * y + frame[6] * z + frame[7];
    zs[i] = frame[8] * x + frame[9] * y + frame[10] * z + frame[11];
  }
  // A mirroring map turns every face inside out, so its normals are turned back.
  const handed = determinant(frame) < 0 ? -1 : 1;
  const faces = indices.length / 3;
  const side = new Int8Array(faces);
  const tone = new Int8Array(faces);
  const nx = new Float64Array(faces);
  const ny = new Float64Array(faces);
  const nz = new Float64Array(faces);
  const flat = new Uint8Array(faces);
  const corner = (t: number, e: number) => weld[indices[t * 3 + e]];
  for (let t = 0; t < faces; t++) {
    if (degenerate[t]) continue;
    const a = corner(t, 0);
    const b = corner(t, 1);
    const c = corner(t, 2);
    const ux = xs[b] - xs[a];
    const uy = ys[b] - ys[a];
    const uz = zs[b] - zs[a];
    const vx = xs[c] - xs[a];
    const vy = ys[c] - ys[a];
    const vz = zs[c] - zs[a];
    let cx = uy * vz - uz * vy;
    let cy = uz * vx - ux * vz;
    let cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-12) {
      flat[t] = 1;
      continue;
    }
    cx = (cx / len) * handed;
    cy = (cy / len) * handed;
    cz = (cz / len) * handed;
    nx[t] = cx;
    ny[t] = cy;
    nz[t] = cz;
    const s = cz > 0 ? 1 : closed[t] ? 0 : -1;
    side[t] = s;
    if (s === 0) continue;
    const lit = (cx * light[0] + cy * light[1] + cz * light[2]) * s;
    tone[t] = Math.min(
      TONE_STEPS - 1,
      Math.floor((0.5 + 0.5 * lit) * TONE_STEPS),
    );
  }

  // The faces seen on one side, merged whatever their tone, give the outline; split by tone they give the lit patches.
  const outline: number[][] = [];
  for (const members of floodPatches(across, side, null).members) {
    outline.push(...patchLoops(members, side, across, corner, xs, ys, null));
  }
  const { patch, members: byPatch } = floodPatches(across, side, tone);
  const regions: ShapeRegion[] = byPatch.map((members) => {
    let weight = 0;
    let depth = 0;
    for (const t of members) {
      const area = Math.abs(nz[t]) + 1e-9;
      weight += area;
      depth +=
        ((zs[corner(t, 0)] + zs[corner(t, 1)] + zs[corner(t, 2)]) / 3) * area;
    }
    return {
      loops: patchLoops(members, side, across, corner, xs, ys, patch),
      depth: depth / weight,
      tone: tone[members[0]],
    };
  });

  let seen = 0;
  for (let t = 0; t < faces; t++) if (side[t] !== 0) seen++;
  const triangles = new Float64Array(seen * 9);
  const triangleRegion = new Int32Array(seen);
  let k = 0;
  for (let t = 0; t < faces; t++) {
    if (side[t] === 0) continue;
    for (let e = 0; e < 3; e++) {
      const v = corner(t, e);
      triangles[k * 9 + e * 3] = xs[v];
      triangles[k * 9 + e * 3 + 1] = ys[v];
      triangles[k * 9 + e * 3 + 2] = zs[v];
    }
    triangleRegion[k++] = patch[t];
  }

  const creases: number[] = [];
  for (let t = 0; t < faces; t++) {
    if (degenerate[t] || flat[t]) continue;
    for (let e = 0; e < 3; e++) {
      const joined = across[t * 3 + e];
      // A face too small to have a direction is no neighbour, so its edge reads as open.
      const u = joined !== -1 && flat[joined] ? -1 : joined;
      // Each shared edge is looked at once, from its lower face.
      if (u !== -1 && u < t) continue;
      if (!edgeIsCrease(t, u, side, nx, ny, nz)) continue;
      const a = corner(t, e);
      const b = corner(t, (e + 1) % 3);
      creases.push(xs[a], ys[a], zs[a], xs[b], ys[b], zs[b]);
    }
  }
  return { outline, regions, triangles, triangleRegion, creases };
}

/**
 * Whether the edge of face `t` shared with face `u` (-1 for an open edge) is
 * drawn: an open edge of a face seen, an edge between a face seen and one
 * not, or one where two faces seen meet at more than `CREASE_ANGLE_DEG`.
 */
function edgeIsCrease(
  t: number,
  u: number,
  side: Int8Array,
  nx: Float64Array,
  ny: Float64Array,
  nz: Float64Array,
): boolean {
  if (u === -1) return side[t] !== 0;
  if (side[t] === 0 && side[u] === 0) return false;
  if (side[t] !== side[u]) return true;
  return nx[t] * nx[u] + ny[t] * ny[u] + nz[t] * nz[u] < CREASE_COS;
}

/**
 * Faces seen from one side that touch edge to edge, and share a value of
 * `key` when one is given, grouped into patches. Faces not seen belong to none.
 */
function floodPatches(
  across: Int32Array,
  side: Int8Array,
  key: Int8Array | null,
): { patch: Int32Array; members: number[][] } {
  const faces = side.length;
  const patch = new Int32Array(faces).fill(-1);
  const members: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < faces; start++) {
    if (side[start] === 0 || patch[start] !== -1) continue;
    const id = members.length;
    const list: number[] = [];
    patch[start] = id;
    stack.push(start);
    while (stack.length) {
      const t = stack.pop() as number;
      list.push(t);
      for (let e = 0; e < 3; e++) {
        const u = across[t * 3 + e];
        if (
          u !== -1 &&
          patch[u] === -1 &&
          side[u] === side[t] &&
          (key === null || key[u] === key[t])
        ) {
          patch[u] = id;
          stack.push(u);
        }
      }
    }
    members.push(list);
  }
  return { patch, members };
}

/**
 * The outline of one patch: the edges its faces do not share with each other,
 * each run the way its face winds (turned for the far side of a sheet, so
 * every outline winds the same way on screen), chained into closed loops.
 * With `patch` given, an edge is shared only with a face of the same patch;
 * without it, with any face seen from the same side.
 */
function patchLoops(
  members: readonly number[],
  side: Int8Array,
  across: Int32Array,
  corner: (t: number, e: number) => number,
  xs: Float64Array,
  ys: Float64Array,
  patch: Int32Array | null,
): number[][] {
  const next = new Map<number, number[]>();
  for (const t of members) {
    for (let e = 0; e < 3; e++) {
      const u = across[t * 3 + e];
      const shared =
        u !== -1 &&
        side[u] === side[t] &&
        (patch === null || patch[u] === patch[t]);
      if (shared) continue;
      let from = corner(t, e);
      let to = corner(t, (e + 1) % 3);
      if (side[t] < 0) [from, to] = [to, from];
      const list = next.get(from);
      if (list) list.push(to);
      else next.set(from, [to]);
    }
  }
  return traceLoops(next, xs, ys).map(simplifyLoop);
}

/** A point closer than this to the line through its neighbours adds nothing to an outline, in metres. */
const STRAIGHT_TOLERANCE = 0.001;

/** Drops the points of a closed outline that lie on the straight line between the points either side of them. */
function simplifyLoop(loop: number[]): number[] {
  const n = loop.length / 2;
  if (n <= 3) return loop;
  const out: number[] = [loop[0], loop[1]];
  for (let i = 1; i < n; i++) {
    const px = out[out.length - 2];
    const py = out[out.length - 1];
    const x = loop[i * 2];
    const y = loop[i * 2 + 1];
    const j = (i + 1) % n;
    const qx = loop[j * 2];
    const qy = loop[j * 2 + 1];
    const len = Math.hypot(qx - px, qy - py);
    const off =
      len < 1e-12
        ? Math.hypot(x - px, y - py)
        : Math.abs((qx - px) * (y - py) - (qy - py) * (x - px)) / len;
    if (off >= STRAIGHT_TOLERANCE) out.push(x, y);
  }
  return out.length >= 6 ? out : loop;
}

/** Follows open edges from point to point until each closes on itself. */
function traceLoops(
  next: Map<number, number[]>,
  xs: Float64Array,
  ys: Float64Array,
): number[][] {
  const loops: number[][] = [];
  for (const [start, outs] of next) {
    while (outs.length) {
      const loop: number[] = [xs[start], ys[start]];
      let at = outs.pop() as number;
      let steps = 0;
      while (at !== start && steps++ < 65536) {
        loop.push(xs[at], ys[at]);
        const onward = next.get(at);
        if (!onward || onward.length === 0) break;
        at = onward.pop() as number;
      }
      if (loop.length >= 6) loops.push(loop);
    }
  }
  return loops;
}

/** Rounds to the millimetre for path data, without a negative zero. */
function mm(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? "0" : String(r);
}

/* After a move, further pairs of numbers are lines, so a loop needs one command letter for its start. */
function loopPath(loop: number[]): string {
  let d = `M${mm(loop[0])} ${mm(loop[1])}`;
  for (let i = 2; i < loop.length; i += 2)
    d += ` ${mm(loop[i])} ${mm(loop[i + 1])}`;
  return `${d}Z`;
}

/** How many cells the depth grid has across the longer side of a part. */
const DEPTH_GRID = 64;

/**
 * Which patch is nearest the viewer across a grid laid over the part: a
 * coarse depth buffer, each cell sampled at its centre, with every face's
 * covered cells kept so the patches can be ordered without a second pass.
 */
interface DepthGrid {
  x0: number;
  y0: number;
  cell: number;
  width: number;
  height: number;
  depth: Float64Array;
  /** The nearest patch in each cell, -1 where nothing is. */
  top: Int32Array;
  /** How far apart two depths must be to count as one in front of the other. */
  slack: number;
  /** Every cell a face covers: the cell, the face's depth there and the face's patch, `hitCount` long. */
  hitCell: Int32Array;
  hitDepth: Float64Array;
  hitRegion: Int32Array;
  hitCount: number;
}

function addHit(grid: DepthGrid, cell: number, z: number, region: number) {
  if (grid.hitCount === grid.hitCell.length) {
    const size = grid.hitCell.length * 2;
    const cells = new Int32Array(size);
    cells.set(grid.hitCell);
    const depths = new Float64Array(size);
    depths.set(grid.hitDepth);
    const regions = new Int32Array(size);
    regions.set(grid.hitRegion);
    grid.hitCell = cells;
    grid.hitDepth = depths;
    grid.hitRegion = regions;
  }
  grid.hitCell[grid.hitCount] = cell;
  grid.hitDepth[grid.hitCount] = z;
  grid.hitRegion[grid.hitCount] = region;
  grid.hitCount++;
  if (z > grid.depth[cell]) {
    grid.depth[cell] = z;
    grid.top[cell] = region;
  }
}

/** Records each grid cell whose centre falls inside the triangle starting at `tris[i]`. */
function rasterise(
  grid: DepthGrid,
  tris: Float64Array,
  i: number,
  region: number,
): void {
  const ax = tris[i];
  const ay = tris[i + 1];
  const az = tris[i + 2];
  const bx = tris[i + 3];
  const by = tris[i + 4];
  const bz = tris[i + 5];
  const cx = tris[i + 6];
  const cy = tris[i + 7];
  const cz = tris[i + 8];
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (Math.abs(area) < 1e-14) return;
  const { x0, y0, cell, width, height } = grid;
  const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / cell - 0.5));
  const i1 = Math.min(
    width - 1,
    Math.floor((Math.max(ax, bx, cx) - x0) / cell - 0.5),
  );
  const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / cell - 0.5));
  const j1 = Math.min(
    height - 1,
    Math.floor((Math.max(ay, by, cy) - y0) / cell - 0.5),
  );
  // Each corner's weight is linear across the grid, so it is a constant plus a step per column and per row.
  const aBase = (bx * cy - cx * by) / area;
  const aX = (by - cy) / area;
  const aY = (cx - bx) / area;
  const bBase = (cx * ay - ax * cy) / area;
  const bX = (cy - ay) / area;
  const bY = (ax - cx) / area;
  for (let j = j0; j <= j1; j++) {
    const py = y0 + (j + 0.5) * cell;
    for (let ii = i0; ii <= i1; ii++) {
      const px = x0 + (ii + 0.5) * cell;
      const wa = aBase + aX * px + aY * py;
      const wb = bBase + bX * px + bY * py;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      addHit(grid, j * width + ii, wa * az + wb * bz + wc * cz, region);
    }
  }
}

function depthGrid(views: readonly MeshView[], offsets: number[]): DepthGrid {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of views) {
    for (let i = 0; i < v.triangles.length; i += 3) {
      minX = Math.min(minX, v.triangles[i]);
      maxX = Math.max(maxX, v.triangles[i]);
      minY = Math.min(minY, v.triangles[i + 1]);
      maxY = Math.max(maxY, v.triangles[i + 1]);
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const cell = span / DEPTH_GRID;
  const width = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const height = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const grid: DepthGrid = {
    x0: minX,
    y0: minY,
    cell,
    width,
    height,
    depth: new Float64Array(width * height).fill(-Infinity),
    top: new Int32Array(width * height).fill(-1),
    slack: cell * 1.5,
    hitCell: new Int32Array(4096),
    hitDepth: new Float64Array(4096),
    hitRegion: new Int32Array(4096),
    hitCount: 0,
  };
  views.forEach((v, m) => {
    for (let t = 0; t < v.triangleRegion.length; t++) {
      rasterise(grid, v.triangles, t * 9, offsets[m] + v.triangleRegion[t]);
    }
  });
  return grid;
}

/**
 * The patches in an order that paints each cell's nearest patch after every
 * other patch under it, in as few runs of one tone as that allows. A patch
 * hidden in every cell it covers is left out; one too small to cover a cell
 * centre is kept, in depth order.
 */
function paintRuns(
  regions: readonly ShapeRegion[],
  grid: DepthGrid,
): number[][] {
  const n = regions.length;
  const after = Array.from({ length: n }, () => new Set<number>());
  const covers = new Uint8Array(n);
  const shows = new Uint8Array(n);
  for (let h = 0; h < grid.hitCount; h++) {
    const region = grid.hitRegion[h];
    const c = grid.hitCell[h];
    covers[region] = 1;
    const top = grid.top[c];
    if (top === region || grid.hitDepth[h] >= grid.depth[c] - grid.slack) {
      shows[region] = 1;
    } else {
      after[region].add(top);
    }
  }
  const kept: number[] = [];
  for (let r = 0; r < n; r++) if (shows[r] || !covers[r]) kept.push(r);
  const keptSet = new Set(kept);
  const waiting = new Int32Array(n);
  for (const r of kept) {
    for (const s of after[r]) if (keptSet.has(s) && s !== r) waiting[s]++;
  }
  const runs: number[][] = [];
  const done = new Uint8Array(n);
  let left = kept.length;
  while (left > 0) {
    let ready = kept.filter((r) => !done[r] && waiting[r] === 0);
    // Patches that each cover the other somewhere are drawn farthest first.
    if (ready.length === 0) {
      ready = [
        kept
          .filter((r) => !done[r])
          .reduce((a, b) => (regions[a].depth <= regions[b].depth ? a : b)),
      ];
    }
    const counts = new Map<number, number>();
    for (const r of ready)
      counts.set(regions[r].tone, (counts.get(regions[r].tone) ?? 0) + 1);
    let tone = regions[ready[0]].tone;
    for (const [t, c] of counts) if (c > (counts.get(tone) ?? 0)) tone = t;
    const run = ready
      .filter((r) => regions[r].tone === tone)
      .sort((a, b) => regions[a].depth - regions[b].depth);
    for (const r of run) {
      done[r] = 1;
      left--;
      for (const s of after[r]) if (keptSet.has(s) && s !== r) waiting[s]--;
    }
    runs.push(run);
  }
  return runs;
}

/** Whether any of three points along a segment is not behind the part's own faces. */
function creaseShows(
  grid: DepthGrid,
  c: readonly number[],
  i: number,
): boolean {
  for (const f of [0.25, 0.5, 0.75]) {
    const x = c[i] + (c[i + 3] - c[i]) * f;
    const y = c[i + 1] + (c[i + 4] - c[i + 1]) * f;
    const z = c[i + 2] + (c[i + 5] - c[i + 2]) * f;
    const gi = Math.floor((x - grid.x0) / grid.cell);
    const gj = Math.floor((y - grid.y0) / grid.cell);
    if (gi < 0 || gj < 0 || gi >= grid.width || gj >= grid.height) return true;
    const cell = gj * grid.width + gi;
    if (grid.top[cell] === -1 || z >= grid.depth[cell] - grid.slack)
      return true;
  }
  return false;
}

/**
 * The part's meshes as seen from one place, combined into path data: the
 * outline of all of them, the lit patches in runs of one tone ordered so the
 * nearest patch is painted last wherever patches overlap, and the sharp edges
 * the part's own faces do not hide.
 */
export function combineViews(views: readonly MeshView[]): ShapeDrawing {
  const outline = views
    .flatMap((v) => v.outline)
    .map(loopPath)
    .join("");
  const offsets: number[] = [];
  const regions: ShapeRegion[] = [];
  for (const v of views) {
    offsets.push(regions.length);
    regions.push(...v.regions);
  }
  if (regions.length === 0) return { outline, faces: [], creases: "" };
  const grid = depthGrid(views, offsets);
  const faces = paintRuns(regions, grid)
    .map((run) => ({
      tone: regions[run[0]].tone,
      d: run.map((r) => regions[r].loops.map(loopPath).join("")).join(""),
    }))
    .filter((face) => face.d);
  let creases = "";
  for (const v of views) {
    for (let i = 0; i < v.creases.length; i += 6) {
      if (!creaseShows(grid, v.creases, i)) continue;
      creases += `M${mm(v.creases[i])} ${mm(v.creases[i + 1])} ${mm(v.creases[i + 3])} ${mm(v.creases[i + 4])}`;
    }
  }
  return { outline, faces, creases };
}

/** Keys rounded to a tenth of a millimetre or a ten-thousandth, so float noise does not miss the cache. */
function keyOf(values: readonly number[]): string {
  return values.map((v) => Math.round(v * 1e4)).join(",");
}

/* Caches are small and cleared when full, since a part's place changes only when the view turns or a mesh moves. */
const CACHE_LIMIT = 128;
const meshViews = new WeakMap<DecodedPartShapeMesh, Map<string, MeshView>>();
const drawings = new WeakMap<DecodedPartShape, Map<string, ShapeDrawing>>();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

function cachedMeshView(
  mesh: DecodedPartShapeMesh,
  frame: Affine,
  light: readonly [number, number, number],
): MeshView {
  let cache = meshViews.get(mesh);
  if (!cache) {
    cache = new Map();
    meshViews.set(mesh, cache);
  }
  const key = keyOf([...frame, ...light]);
  return cache.get(key) ?? remember(cache, key, viewMesh(mesh, frame, light));
}

/**
 * The part's shape seen through `frame`, which carries part-local points into
 * the drawn box's frame (x across, y up, z toward the viewer), lit from
 * `light` in that frame. A mesh is drawn when its pose says it is shown, or
 * when it has no pose and the shape shows it; a posed mesh is moved by its
 * pose's matrix first. Each mesh's view is kept per place and pose, and the
 * whole drawing per place and set of poses, so parts of one kind standing
 * the same way share one projection.
 */
export function drawShape(
  shape: DecodedPartShape,
  frame: Affine,
  light: readonly [number, number, number],
  poses?: ShapePoses,
): ShapeDrawing {
  const poseKey = poses
    ? poses
        .map(
          (p) =>
            `${p.mesh}:${p.shown ? 1 : 0}:${p.transform ? keyOf(p.transform) : ""}`,
        )
        .join(";")
    : "";
  const key = `${keyOf([...frame, ...light])}|${poseKey}`;
  let cache = drawings.get(shape);
  if (!cache) {
    cache = new Map();
    drawings.set(shape, cache);
  }
  const kept = cache.get(key);
  if (kept) return kept;
  const byMesh = new Map(poses?.map((p) => [p.mesh, p]));
  const views: MeshView[] = [];
  for (const mesh of shape.meshes) {
    const pose = byMesh.get(mesh.key);
    if (!(pose ? pose.shown : mesh.shown)) continue;
    const placed =
      pose?.transform && pose.transform.length === 12
        ? composeAffine(frame, pose.transform)
        : frame;
    views.push(cachedMeshView(mesh, placed, light));
  }
  return remember(cache, key, combineViews(views));
}

/** How far a shape's extent may stray from its part's box on any axis before the part is drawn by its type: this share of the box, or this many metres, whichever is more. */
const FIT_SHARE = 0.1;
const FIT_METRES = 0.05;

const fits = new WeakMap<DecodedPartShape, Map<string, boolean>>();

/**
 * Whether `shape`, with `poses` moving its meshes, fills the part's own box
 * of `size` (part-local metres) on every axis. Every mesh counts, drawn or
 * not, as it does in the box. A part built or stretched in the game, such as
 * a procedural tank, a fairing's shell or a fuel line, has a box the shape of
 * its kind does not fill, and is drawn by its type within its box instead.
 */
export function shapeFitsBox(
  shape: DecodedPartShape,
  size: { x: number; y: number; z: number },
  poses?: ShapePoses,
): boolean {
  const poseKey = poses
    ? poses
        .map((p) => `${p.mesh}:${p.transform ? keyOf(p.transform) : ""}`)
        .join(";")
    : "";
  const key = `${keyOf([size.x, size.y, size.z])}|${poseKey}`;
  let cache = fits.get(shape);
  if (!cache) {
    cache = new Map();
    fits.set(shape, cache);
  }
  const kept = cache.get(key);
  if (kept !== undefined) return kept;

  const byMesh = new Map(poses?.map((p) => [p.mesh, p]));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of shape.meshes) {
    const m = byMesh.get(mesh.key)?.transform;
    const moved = m && m.length === 12 ? m : undefined;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      const at = moved
        ? [
            moved[0] * x + moved[1] * y + moved[2] * z + moved[3],
            moved[4] * x + moved[5] * y + moved[6] * z + moved[7],
            moved[8] * x + moved[9] * y + moved[10] * z + moved[11],
          ]
        : [x, y, z];
      for (let a = 0; a < 3; a++) {
        if (at[a] < lo[a]) lo[a] = at[a];
        if (at[a] > hi[a]) hi[a] = at[a];
      }
    }
  }
  const box = [size.x, size.y, size.z];
  const fit =
    lo[0] <= hi[0] &&
    box.every(
      (extent, a) =>
        Math.abs(hi[a] - lo[a] - extent) <=
        Math.max(FIT_METRES, FIT_SHARE * extent),
    );
  return remember(cache, key, fit);
}
