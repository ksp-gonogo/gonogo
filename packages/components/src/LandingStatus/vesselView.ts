/**
 * The geometry of the view from the vessel: a camera at the craft aimed at the predicted site, the ground seen through it as a height field, and what is hidden behind what.
 * Positions are metres east, north and up of the predicted site's ground, the frame the mod's terrain grid is in.
 */

export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;

/** The field of view when the craft is at the ground, degrees. */
export const VIEW_FOV_FLOOR_DEG = 20;
/** How much wider the view is, degrees, for a craft far above the ground. */
export const VIEW_FOV_SPAN_DEG = 50;
/** The height, metres, at which the view has opened half of its span: the field narrows as the craft comes down. */
export const VIEW_FOV_KNEE_M = 1500;

/** The field of view, degrees, of a craft this high above the ground. */
export function viewFovDegrees(heightMeters: number): number {
  const h = Math.max(0, heightMeters);
  return VIEW_FOV_FLOOR_DEG + (VIEW_FOV_SPAN_DEG * h) / (h + VIEW_FOV_KNEE_M);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, -1];
};

/** What is seen at a point of the screen, whose x and y both run from -1 to 1 across the field of view. */
export interface Camera {
  eye: Vec3;
  fovDegrees: number;
  /** Screen position of a point and its distance along the view, or null behind the eye. */
  project(p: Vec3): { x: number; y: number; depth: number } | null;
  /** The unit direction seen at a screen position. */
  ray(x: number, y: number): Vec3;
}

/**
 * A camera at `eye` looking at `target`, with the way the craft travels (`headingDeg`, clockwise from north) up the screen when it looks straight down, and the level horizon kept level otherwise.
 */
export function cameraAt(
  eye: Vec3,
  target: Vec3,
  headingDeg: number,
  fovDegrees: number,
): Camera {
  const forward = unit(sub(target, eye));
  const heading = headingDeg * DEG;
  const right: Vec3 = [Math.cos(heading), -Math.sin(heading), 0];
  const up = cross(right, forward);
  const tan = Math.tan((fovDegrees * DEG) / 2);
  return {
    eye,
    fovDegrees,
    project(p) {
      const d = sub(p, eye);
      const depth = dot(d, forward);
      if (depth < 1) return null;
      return {
        x: dot(d, right) / (depth * tan),
        y: dot(d, up) / (depth * tan),
        depth,
      };
    },
    ray(x, y) {
      return unit([
        forward[0] + tan * (x * right[0] + y * up[0]),
        forward[1] + tan * (x * right[1] + y * up[1]),
        forward[2] + tan * (x * right[2] + y * up[2]),
      ]);
    },
  };
}

/** The mod's grid of terrain heights, as a surface that can be read anywhere inside it. */
export interface HeightField {
  /** Half the grid's width, metres. */
  half: number;
  /** Height at a point, bilinear, or null outside the grid. */
  at(x: number, y: number): number | null;
  min: number;
  max: number;
}

/**
 * The grid as a height field: `size` by `size` values row by row, the northern row first, covering `extentMeters` centred on the site. Over open water `flatSea` holds the ground at the surface, which is what is seen.
 */
export function heightField(
  heights: readonly number[],
  size: number,
  extentMeters: number,
  flatSea: boolean,
): HeightField | null {
  if (size < 2 || heights.length < size * size) return null;
  if (!Number.isFinite(extentMeters) || extentMeters <= 0) return null;
  const values = heights.slice(0, size * size);
  for (const v of values) if (!Number.isFinite(v)) return null;
  const grid = flatSea ? values.map((v) => Math.max(v, 0)) : values;
  const half = extentMeters / 2;
  const cell = extentMeters / size;
  return {
    half,
    min: Math.min(...grid),
    max: Math.max(...grid),
    at(x, y) {
      const fc = (x + half) / cell - 0.5;
      const fr = (half - y) / cell - 0.5;
      if (fc < 0 || fr < 0 || fc > size - 1 || fr > size - 1) return null;
      const c0 = Math.floor(fc);
      const r0 = Math.floor(fr);
      const c1 = Math.min(size - 1, c0 + 1);
      const r1 = Math.min(size - 1, r0 + 1);
      const tc = fc - c0;
      const tr = fr - r0;
      const g = (c: number, r: number) => grid[r * size + c];
      return (
        (g(c0, r0) * (1 - tc) + g(c1, r0) * tc) * (1 - tr) +
        (g(c0, r1) * (1 - tc) + g(c1, r1) * tc) * tr
      );
    },
  };
}

/** The skyline at a bearing, degrees above the level, interpolated between the profile's entries; null with no profile. */
export function skylineAt(
  angles: readonly number[] | null,
  azimuthDeg: number,
): number | null {
  if (!angles || angles.length < 2) return null;
  const n = angles.length;
  const f = ((((azimuthDeg % 360) + 360) % 360) / 360) * n;
  const i = Math.floor(f);
  const t = f - i;
  return angles[i % n] * (1 - t) + angles[(i + 1) % n] * t;
}

/** The bearing of a direction, degrees clockwise from north. */
export function bearingOf(d: Vec3): number {
  return (Math.atan2(d[0], d[1]) / DEG + 360) % 360;
}

/** The angle of a direction above the level, degrees. */
export function elevationOf(d: Vec3): number {
  return Math.atan2(d[2], Math.hypot(d[0], d[1])) / DEG;
}

/**
 * Whether the ground at `point` is seen from the eye: nothing in the grid stands above the line between them.
 * The grid holds the vessel and the site and the ground between, so whatever can hide a point of the plot from the craft is in it; the skyline lies beyond, behind everything the plot marks.
 */
export function groundPointVisible(
  eye: Vec3,
  point: Vec3,
  field: HeightField | null,
): boolean {
  if (!field) return true;
  const steps = 96;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = eye[0] + (point[0] - eye[0]) * t;
    const y = eye[1] + (point[1] - eye[1]) * t;
    const z = eye[2] + (point[2] - eye[2]) * t;
    const g = field.at(x, y);
    if (g != null && g > z + 0.5) return false;
  }
  return true;
}

/** Cells across the terrain raster of the view and of the map: the same, so the two read at one pixelation. */
export const TERRAIN_CELLS = 44;

/** Elevation bands both terrain reliefs are drawn in. */
export const TERRAIN_BANDS = 9;

/** The states ground is shown in, the same in the view and in the map: it keeps its colour, so no state darkens it. */
export const VEIL_NONE = 0;
/** Outside the field of view: desaturated. */
export const VEIL_OUTSIDE = 1;
/** In the field of view but hidden by terrain: desaturated and tinted red. */
export const VEIL_HIDDEN = 2;
/** No data: flat grey. */
export const VEIL_NO_DATA = 3;

/** Metres of height in one colour band, the same in the view and in the map: a height is one colour whatever the grid around it holds, so descending never invents new colours. */
export const TERRAIN_BAND_METRES = 25;

/** The centre of the ground cell a point of ground falls in, cells being `pitch` metres across and centred on the lattice's points. */
export function cellCentre(v: number, pitch: number): number {
  return Math.round(v / pitch) * pitch + 0;
}

/**
 * The marks the view and the map draw the same way, so the site's cross is the landmark that matches them: the ring is a dashed warn line, the track a solid info line, each of one weight.
 */
export const RING_MARK = { tone: "warn", dashed: true, weight: 2.2 } as const;
export const TRACK_MARK = { tone: "info", dashed: false, weight: 2.2 } as const;
export const SITE_MARK_TONE = "info";
/** The ground reference is a field of dots at the lattice crossings; the scatter mark carries its own dark outline so it reads on light ground and dark. */
export const LATTICE_DOT = {
  tone: "neutral",
  dashed: false,
  weight: 1.4,
} as const;
/** A lattice dot's radius as a share of the plot's width, so a small plot shows small dots rather than a few large ones. */
export const LATTICE_DOT_SHARE = 0.0082;
/** The lines of the lattice across a footprint. */
const LATTICE_ACROSS = 9;
/** The site cross is the landmark that matches the two plots, so it is drawn larger than a plain mark. */
export const SITE_MARK_SCALE = 2.8;

/** A terrain raster: heights coloured by an absolute range, and how much of each cell's colour it keeps. */
export interface TerrainRaster {
  /** One height per cell, row by row from the bottom of the screen: the relief layer's first row is its lowest. */
  values: number[];
  veil: number[];
  size: number;
}

/**
 * The ground as the camera sees it, on a `size` by `size` raster of the screen, each cell the height of the ground cell (`cellMeters` across, centred on the lattice's points) its ray first meets: a boundary between heights lies on the lattice's lines. A ray that leaves the grid, or never meets it, is not guessed at: it is far ground below the skyline or sky above it, and takes the lowest height under the no-data veil, far ground desaturated.
 * Null when no ray meets the grid.
 */
export function renderTerrain(
  camera: Camera,
  field: HeightField,
  skyline: readonly number[] | null,
  size: number,
  cellMeters: number,
): TerrainRaster | null {
  const [ex, ey, ez] = camera.eye;
  const lo = field.min;
  const values: number[] = [];
  const veil: number[] = [];
  let anyHit = false;
  for (let row = 0; row < size; row++) {
    // The relief layer reads its first row as the bottom of the plot, so the raster starts at the foot of the screen.
    const sy = -1 + ((row + 0.5) / size) * 2;
    for (let col = 0; col < size; col++) {
      const sx = ((col + 0.5) / size) * 2 - 1;
      const d = camera.ray(sx, sy);
      const hit = marchGround(ex, ey, ez, d, field);
      if (hit != null) {
        anyHit = true;
        values.push(
          field.at(
            cellCentre(hit[0], cellMeters),
            cellCentre(hit[1], cellMeters),
          ) ?? hit[2],
        );
        veil.push(VEIL_NONE);
      } else {
        const sky = skylineAt(skyline, bearingOf(d));
        values.push(lo);
        // Far ground is ground the grid does not hold, seen from afar; sky is no ground at all.
        veil.push(
          sky != null && elevationOf(d) < sky ? VEIL_OUTSIDE : VEIL_NO_DATA,
        );
      }
    }
  }
  return anyHit ? { size, values, veil } : null;
}

/** The first ground along a ray from the eye, east, north and height, or null if it leaves the grid or never meets it. */
function marchGround(
  ex: number,
  ey: number,
  ez: number,
  d: Vec3,
  field: HeightField,
): Vec3 | null {
  const cell = (2 * field.half) / 24;
  const reach = 8 * field.half + 1000;
  let t = 0;
  let before = 0;
  while (t <= reach) {
    const z = ez + d[2] * t;
    const g = field.at(ex + d[0] * t, ey + d[1] * t);
    if (g != null && z <= g) {
      // Between the last step and this one the ray went under the ground: home in on where.
      let lo = before;
      let hi = t;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        const gm = field.at(ex + d[0] * mid, ey + d[1] * mid);
        if (gm != null && ez + d[2] * mid <= gm) hi = mid;
        else lo = mid;
      }
      const x = ex + d[0] * hi;
      const y = ey + d[1] * hi;
      return [x, y, field.at(x, y) ?? g];
    }
    // A ray climbing clear of the highest ground never meets it.
    if (d[2] >= 0 && z > field.max) return null;
    before = t;
    t += Math.max(cell / 3, t * 0.01, 1);
  }
  return null;
}

/** What the camera needs of a touchdown: where the craft is, where the site is, and the ground between. */
export interface SceneInputs {
  /** Ground distance from the vessel to the predicted site, metres. */
  driftMeters: number | null;
  /** Bearing from the vessel to the site, degrees clockwise from north. */
  driftBearingDeg: number | null;
  /** The vessel's altitude above sea level, metres. */
  altitudeAsl: number | null;
  /** The predicted site's ground elevation above sea level, metres. */
  siteElevation: number | null;
  /** Terrain elevations around the predicted site, row-major NxN from the northern row, metres. */
  siteHeights?: readonly number[] | null;
  /** The N of the NxN grid. */
  siteHeightsSize?: number | null;
  /** Ground width the whole grid spans, metres. */
  siteHeightsExtentMeters?: number | null;
  /** The skyline the vessel sees: its highest terrain angle at each of evenly spaced bearings from north. */
  horizonAngles?: readonly number[] | null;
  /** Whether the ground is held at the sea's surface, which is what is seen over an ocean. */
  hasOcean?: boolean;
  /** Height above terrain, metres: sets the field of view. */
  aglMeters: number | null;
}

/** The touchdown as the craft sees it, worked out once for the view and for the map that is its projection. */
export interface TouchdownScene {
  eye: Vec3;
  camera: Camera;
  field: HeightField | null;
  siteGround: number;
  height: number;
  fov: number;
  skyline: readonly number[] | null;
  /** A point of the ground at an east and north from the site. */
  groundAt(x: number, y: number): Vec3;
  /** Whether the grid lets the craft see a point of ground. */
  seen(p: Vec3): boolean;
}

/** The scene, or null without a site to look at or a height to look from. */
export function touchdownScene(
  i: Readonly<SceneInputs>,
): TouchdownScene | null {
  const { driftMeters, driftBearingDeg } = i;
  if (
    driftMeters == null ||
    !Number.isFinite(driftMeters) ||
    driftBearingDeg == null ||
    !Number.isFinite(driftBearingDeg)
  ) {
    return null;
  }
  const height = Math.max(0, i.aglMeters ?? 0);
  const field =
    i.siteHeights != null &&
    i.siteHeightsSize != null &&
    i.siteHeightsExtentMeters != null
      ? heightField(
          i.siteHeights,
          i.siteHeightsSize,
          i.siteHeightsExtentMeters,
          i.hasOcean === true,
        )
      : null;
  const siteGround =
    field?.at(0, 0) ??
    (i.hasOcean === true
      ? 0
      : (i.siteElevation ??
        (i.altitudeAsl != null ? i.altitudeAsl - height : null)));
  const eyeAltitude =
    i.altitudeAsl ?? (siteGround != null ? siteGround + height : null);
  if (siteGround == null || eyeAltitude == null) return null;
  // The site is the origin; the craft stands back from it along the way it came, and looks at it.
  const bearing = (driftBearingDeg * Math.PI) / 180;
  const eye: Vec3 = [
    -driftMeters * Math.sin(bearing),
    -driftMeters * Math.cos(bearing),
    eyeAltitude,
  ];
  const fov = viewFovDegrees(height);
  return {
    eye,
    camera: cameraAt(eye, [0, 0, siteGround], driftBearingDeg, fov),
    field,
    siteGround,
    height,
    fov,
    skyline: i.horizonAngles ?? null,
    groundAt: (x, y) => [x, y, field?.at(x, y) ?? siteGround],
    seen: (p) => groundPointVisible(eye, p, field),
  };
}

/**
 * Where a ray from the eye meets the ground, east and north of the site. A ray that meets none inside the square of half width `limit` about the site, as at the horizon or over the grid's edge, ends where it leaves that square, so a ray changing from one kind to the other moves its end smoothly.
 */
function groundHit(
  eye: Vec3,
  d: Vec3,
  field: HeightField | null,
  siteGround: number,
  limit: number,
): [number, number] {
  const reach = 8 * limit + 1000;
  let before = 0;
  let t = 0;
  let last: [number, number] = [
    Math.max(-limit, Math.min(limit, eye[0])),
    Math.max(-limit, Math.min(limit, eye[1])),
  ];
  while (t <= reach) {
    const x = eye[0] + d[0] * t;
    const y = eye[1] + d[1] * t;
    const z = eye[2] + d[2] * t;
    if (Math.abs(x) > limit || Math.abs(y) > limit) break;
    last = [x, y];
    const g = field ? field.at(x, y) : siteGround;
    if (g != null && z <= g) {
      let lo = before;
      let hi = t;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        const gm = field
          ? field.at(eye[0] + d[0] * mid, eye[1] + d[1] * mid)
          : siteGround;
        if (gm != null && eye[2] + d[2] * mid <= gm) hi = mid;
        else lo = mid;
      }
      return [eye[0] + d[0] * hi, eye[1] + d[1] * hi];
    }
    before = t;
    t += Math.max(1, t * 0.01);
  }
  return last;
}

/**
 * The frame's footprint on the ground, as east and north of the site, counter-clockwise: where the four edges of the screen meet the ground, held within `limit` of the site since beyond the grid nothing is known.
 */
export function frameFootprint(
  scene: TouchdownScene,
  limit: number,
): [number, number][] {
  const { camera, eye, field, siteGround } = scene;
  const hit = (sx: number, sy: number): [number, number] =>
    groundHit(eye, camera.ray(sx, sy), field, siteGround, limit);
  const steps = 16;
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const ring: [number, number][] = [];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[(c + 1) % 4];
    for (let i = 0; i < steps; i++) {
      const u = i / steps;
      ring.push(hit(ax + (bx - ax) * u, ay + (by - ay) * u));
    }
  }
  const area = ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + (p[0] * q[1] - q[0] * p[1]);
  }, 0);
  return area < 0 ? ring.reverse() : ring;
}

/**
 * The ring of ground that lies `radiusMeters` from the site in space, east and north of it: on level ground the circle of that radius, drawn smaller along a slope the way the distance to a point on the ground really is. Ground the grid does not hold counts as level.
 */
export function zoneRing(
  scene: TouchdownScene,
  radiusMeters: number,
  steps: number,
): [number, number][] {
  const { field, siteGround } = scene;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const sx = Math.sin(a);
    const sy = Math.cos(a);
    const gap = (d: number) =>
      Math.hypot(d, (field?.at(sx * d, sy * d) ?? siteGround) - siteGround) -
      radiusMeters;
    let lo = 0;
    let hi = radiusMeters;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) < 0) lo = mid;
      else hi = mid;
    }
    const d = (lo + hi) / 2;
    out.push([sx * d, sy * d]);
  }
  return out;
}

/** The lattice's pitch for a footprint this wide: the 1, 2 or 5 times a power of ten that gives about nine lines across it, never finer than a metre. */
export function latticePitch(
  acrossMeters: number,
  across: number = LATTICE_ACROSS,
): number {
  const raw = Math.max(1, acrossMeters) / across;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return Math.max(1, (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag);
}

/** The sign a navball heading carries after its three digits. */
const BEARING_SIGN = "°";

/** A bearing the way the navball writes a heading: three digits, clockwise from north. */
export function bearingLabel(degrees: number): string {
  const d = Math.round(((degrees % 360) + 360) % 360) % 360;
  return [String(d).padStart(3, "0"), BEARING_SIGN].join("");
}

/** How wide a footprint is across the way the craft looks, metres: the extent of its corners rotated so the heading is up. */
export function footprintAcross(
  footprint: readonly (readonly [number, number])[],
  headingDeg: number,
): number {
  const h = headingDeg * DEG;
  const us = footprint.map(([x, y]) => x * Math.cos(h) - y * Math.sin(h));
  const vs = footprint.map(([x, y]) => x * Math.sin(h) + y * Math.cos(h));
  return Math.max(
    Math.max(...us) - Math.min(...us),
    Math.max(...vs) - Math.min(...vs),
  );
}

/** The points where the ground lattice's lines cross over a square of ground, and their pitch. */
export interface GroundLattice {
  pitch: number;
  points: [number, number][];
}

export function groundLattice(
  acrossMeters: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): GroundLattice {
  const pitch = latticePitch(acrossMeters);
  const points: [number, number][] = [];
  for (let i = Math.ceil(x0 / pitch); i * pitch <= x1; i++) {
    for (let j = Math.ceil(y0 / pitch); j * pitch <= y1; j++) {
      points.push([i * pitch + 0, j * pitch + 0]);
    }
  }
  return { pitch, points };
}
