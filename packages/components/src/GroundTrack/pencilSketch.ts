import { defaultDarkTheme } from "@ksp-gonogo/ui-kit";

/** Resolved CSS colours the sketch draws with. */
export interface PencilPalette {
  /** The page the sketch is drawn on. */
  paper: string;
  /** Coastlines and landform outlines, the brightest ink. */
  coast: string;
  /** The loose frame around a remote body. */
  ink: string;
  /** The hatching over seas and shadow. */
  hatch: string;
}

/** The colour roles of a theme the palette reads, so a caller can pass the whole theme. */
export interface PencilTheme {
  colors: {
    surface: { raised: string };
    text: { primary: string; muted: string; faint: string };
  };
}

/**
 * Resolves a theme's colour roles into canvas colours: paper is
 * `surface.raised`, coastlines are `text.primary`, the frame is `text.muted`
 * and the hatching is `text.faint`. Theme values are `var(--color-...)`
 * references, which a canvas cannot paint, so each is read back off `root`,
 * where the theme provider writes it. With no theme given, the default theme's
 * roles are read, which is the active theme wherever the provider is mounted.
 */
export function paletteFromTheme(
  theme: PencilTheme = defaultDarkTheme,
  root: Element = document.documentElement,
): PencilPalette {
  const { colors } = theme;
  const style = getComputedStyle(root);
  const resolve = (v: string) => {
    const m = /^var\((--[^),]+)/.exec(v);
    return m ? style.getPropertyValue(m[1]).trim() || v : v;
  };
  return {
    paper: resolve(colors.surface.raised),
    coast: resolve(colors.text.primary),
    ink: resolve(colors.text.muted),
    hatch: resolve(colors.text.faint),
  };
}

export interface PencilOptions {
  palette: PencilPalette;
  /** 0 (loose, few strokes) to 1 (fine, many strokes). */
  detail: number;
  width: number;
  height: number;
  /** Seeds every jitter, so the same body draws the same sketch each time. */
  seed: number;
  /**
   * How much heavier the coastlines are drawn than their natural weight, 1 or
   * more. The sketch is scaled down to the tile it sits in, so a small tile
   * asks for more to keep the same line on screen.
   */
  coastBoost?: number;
}

type Pt = [number, number];

/**
 * Detail below this takes the remote path: a few rounded shapes in a frame, with
 * no stripes. A body one visited step above its natural detail stays on it, so a
 * stepped-up Duna keeps the shapes and not the bands of its texture.
 */
export const REMOTE_BELOW = 0.6;

/** The width of the sketch canvas the widget asks for, which its coastline weight is measured against. */
export const SKETCH_WIDTH = 1024;
export const SKETCH_HEIGHT = 512;

/**
 * The coastline boost for a map shown `shownWidth` pixels across: 1 where the
 * sketch is shown at its own size or larger, rising to 3 for a tile a third of
 * that. Rounded up to a quarter so a window being dragged does not redraw the
 * sketch on every pixel.
 */
export function coastBoostFor(shownWidth: number): number {
  if (!(shownWidth > 0)) return 1;
  const raw = Math.min(3, Math.max(1, SKETCH_WIDTH / shownWidth));
  return Math.ceil(raw * 4) / 4;
}

/** Home body radius over distance gives the angular radius the body shows from home. */
export function apparentSize(radius: number, distance: number): number {
  return radius / distance;
}

/** Angular radius to a 0..1 detail, on a log scale from "a speck" to "a moon overhead". */
export function detailFromApparentSize(
  size: number,
  lo = 5e-7,
  hi = 5e-2,
): number {
  const t =
    (Math.log10(size) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
  return Math.min(1, Math.max(0, t));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function luminanceField(
  image: CanvasImageSource,
  cols: number,
  rows: number,
): Float32Array {
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, cols, rows);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const f = new Float32Array(cols * rows);
  for (let i = 0; i < f.length; i++) {
    f[i] =
      (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  return f;
}

function blur(
  f: Float32Array,
  cols: number,
  rows: number,
  r: number,
): Float32Array {
  if (r < 1) return f;
  let src = f;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(src.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(cols - 1, Math.max(0, x + k));
          s += src[y * cols + xx];
          n++;
        }
        tmp[y * cols + x] = s / n;
      }
    }
    const out = new Float32Array(src.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(rows - 1, Math.max(0, y + k));
          s += tmp[yy * cols + x];
          n++;
        }
        out[y * cols + x] = s / n;
      }
    }
    src = out;
  }
  return src;
}

/** Subtracts each row's mean from the grid and puts the grid's overall mean back, in place. */
function removeLatitudeBands(
  f: Float32Array,
  cols: number,
  rows: number,
): void {
  let total = 0;
  for (const v of f) total += v;
  const mean = total / f.length;
  for (let y = 0; y < rows; y++) {
    let rowSum = 0;
    for (let x = 0; x < cols; x++) rowSum += f[y * cols + x];
    const shift = mean - rowSum / cols;
    for (let x = 0; x < cols; x++) f[y * cols + x] += shift;
  }
}

function otsu(f: Float32Array, below = 1): number {
  const bins = 64;
  const h = new Float64Array(bins);
  let total = 0;
  for (const v of f) {
    if (v >= below) continue;
    h[Math.min(bins - 1, Math.floor(v * bins))]++;
    total++;
  }
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * h[i];
  let wB = 0;
  let sB = 0;
  let best = 0;
  let thr = bins / 2;
  for (let i = 0; i < bins; i++) {
    wB += h[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sB += i * h[i];
    const mB = sB / wB;
    const mF = (sum - sB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = i;
    }
  }
  return (thr + 1) / bins;
}

/** Marching squares over the cell-centre grid; returns chained polylines in cell units. */
function contours(
  f: Float32Array,
  cols: number,
  rows: number,
  thr: number,
): Pt[][] {
  const segs: [Pt, Pt][] = [];
  const v = (x: number, y: number) => f[y * cols + x] - thr;
  const lerp = (a: number, b: number) => a / (a - b);
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const a = v(x, y);
      const b = v(x + 1, y);
      const c = v(x + 1, y + 1);
      const d = v(x, y + 1);
      const idx =
        (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top: Pt = [x + lerp(a, b), y];
      const right: Pt = [x + 1, y + lerp(b, c)];
      const bottom: Pt = [x + lerp(d, c), y + 1];
      const left: Pt = [x, y + lerp(a, d)];
      switch (idx) {
        case 1:
        case 14:
          segs.push([left, bottom]);
          break;
        case 2:
        case 13:
          segs.push([bottom, right]);
          break;
        case 3:
        case 12:
          segs.push([left, right]);
          break;
        case 4:
        case 11:
          segs.push([top, right]);
          break;
        case 5:
          segs.push([left, top], [bottom, right]);
          break;
        case 10:
          segs.push([top, right], [left, bottom]);
          break;
        case 6:
        case 9:
          segs.push([top, bottom]);
          break;
        case 7:
        case 8:
          segs.push([left, top]);
          break;
      }
    }
  }
  const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const arr = ends.get(k);
      if (arr) arr.push(i);
      else ends.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: Pt[][] = [];
  const next = (p: Pt): number => {
    const arr = ends.get(key(p));
    if (!arr) return -1;
    for (const i of arr) if (!used[i]) return i;
    return -1;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: Pt[] = [segs[i][0], segs[i][1]];
    for (;;) {
      const j = next(line[line.length - 1]);
      if (j < 0) break;
      used[j] = 1;
      const [p, q] = segs[j];
      const last = key(line[line.length - 1]);
      line.push(key(p) === last ? q : p);
    }
    for (;;) {
      const j = next(line[0]);
      if (j < 0) break;
      used[j] = 1;
      const [p, q] = segs[j];
      const first = key(line[0]);
      line.unshift(key(p) === first ? q : p);
    }
    out.push(line);
  }
  return out;
}

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let worst = 0;
  let wi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d =
      Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > worst) {
      worst = d;
      wi = i;
    }
  }
  if (worst <= eps) return [pts[0], pts[pts.length - 1]];
  return [
    ...rdp(pts.slice(0, wi + 1), eps).slice(0, -1),
    ...rdp(pts.slice(wi), eps),
  ];
}

function pathLength(p: Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++)
    s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}

function chaikin(p: Pt[], rounds: number): Pt[] {
  let q = p;
  for (let r = 0; r < rounds; r++) {
    if (q.length < 3) return q;
    const n: Pt[] = [q[0]];
    for (let i = 0; i < q.length - 1; i++) {
      const [ax, ay] = q[i];
      const [bx, by] = q[i + 1];
      n.push(
        [ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25],
        [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75],
      );
    }
    n.push(q[q.length - 1]);
    q = n;
  }
  return q;
}

function graphiteStroke(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  rnd: () => number,
  jitter: number,
  width: number,
  alpha: number,
  colour: string,
): void {
  const dense: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 14));
    for (let k = 0; k < n; k++)
      dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  dense.push(pts[pts.length - 1]);
  const j = dense.map(
    ([x, y]): Pt => [
      x + (rnd() - 0.5) * 2 * jitter,
      y + (rnd() - 0.5) * 2 * jitter,
    ],
  );
  ctx.beginPath();
  ctx.moveTo(j[0][0], j[0][1]);
  for (let i = 1; i < j.length - 1; i++) {
    ctx.quadraticCurveTo(
      j[i][0],
      j[i][1],
      (j[i][0] + j[i + 1][0]) / 2,
      (j[i][1] + j[i + 1][1]) / 2,
    );
  }
  ctx.lineTo(j[j.length - 1][0], j[j.length - 1][1]);
  ctx.lineWidth = width * (0.8 + rnd() * 0.5);
  ctx.strokeStyle = colour;
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The lines a sketch is drawn from, in canvas pixels and in the order they are drawn. */
export interface SketchPlan {
  /** Coastline and landform outlines, longest first. */
  coast: Pt[][];
  /** Hatching runs as start and end points. */
  hatch: [Pt, Pt][];
  /** The loose frame of a remote body. */
  frame: Pt[] | null;
}

/** The luminance grid a sketch of this detail reads, in columns and rows. */
export function fieldSize(detail: number): { cols: number; rows: number } {
  const d = Math.min(1, Math.max(0, detail));
  const remote = d < REMOTE_BELOW;
  const cols = Math.round((remote ? 28 : 40) + (remote ? 100 : 120) * d);
  return { cols, rows: Math.round(cols / 2) };
}

/**
 * Works out every line of the sketch from a luminance grid of {@link fieldSize}
 * columns and rows, with no drawing and no randomness, so the same grid always
 * gives the same plan.
 */
export function planSketch(
  raw: Float32Array,
  width: number,
  height: number,
  detail: number,
): SketchPlan {
  const d = Math.min(1, Math.max(0, detail));
  const remote = d < REMOTE_BELOW;
  const { cols, rows } = fieldSize(d);
  const shape = blur(raw, cols, rows, 1);
  const t1 = otsu(shape);
  const t2 = otsu(shape, t1);
  const sx = width / cols;
  const sy = height / rows;

  const eps = (remote ? 14 - 10 * d : 9 - 7.5 * d) / sx;
  const minLen = (remote ? 40 : 70 - 50 * d) / sx;
  // A remote body also splits its terrain at two low tones, which gives a few rounded blobs even where the texture has one dominant tone.
  const all = Array.from(shape).sort((a, b) => a - b);
  const tm = all[Math.floor((all.length - 1) * 0.3)];
  let lines = [
    ...contours(shape, cols, rows, t1),
    ...contours(shape, cols, rows, remote ? tm : t2),
    ...(remote
      ? contours(shape, cols, rows, all[Math.floor((all.length - 1) * 0.15)])
      : []),
  ];
  if (remote) {
    // A contour spanning most of the map is a polar band, which reads as a stripe, not a landform.
    lines = lines.filter((l) => {
      const xs = l.map((p) => p[0]);
      return Math.max(...xs) - Math.min(...xs) < cols * 0.5;
    });
  }
  const kept: Pt[][] = [];
  for (const line of lines) {
    let simple = rdp(line, eps);
    if (pathLength(simple) < minLen) continue;
    if (remote) simple = chaikin(simple, 2);
    kept.push(simple);
  }
  kept.sort((a, b) => pathLength(b) - pathLength(a));
  const coast = kept
    .slice(0, remote ? Math.round(3 + 14 * d) : kept.length)
    .map((l) => l.map(([x, y]): Pt => [x * sx, y * sy]));

  const tone = blur(raw, cols, rows, Math.round(6 - 3 * d));
  // Whatever depends on latitude alone is a band across the whole map, which hatches as a stripe.
  if (remote) removeLatitudeBands(tone, cols, rows);
  let lo = 1;
  let hi = 0;
  for (const v of tone) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const toneSorted = remote ? Array.from(tone).sort((a, b) => a - b) : [];
  const top = remote
    ? toneSorted[Math.floor((toneSorted.length - 1) * 0.92)]
    : hi;
  const floor = remote
    ? toneSorted[Math.floor((toneSorted.length - 1) * 0.08)]
    : lo;
  const norm = (x: number, y: number) => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / sx)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / sy)));
    return (tone[cy * cols + cx] - floor) / (top - floor || 1);
  };
  const spacing = (remote ? 20 : 15) - 7 * d;
  const diag = width + height;
  // A remote body's hatch scale spans the main terrain's own tones, so a bright polar cap does not turn the whole terrain band into one dark region.
  const base = remote ? 0.4 : (t2 - lo) / (hi - lo || 1);
  const passes: [number, number, number][] = [
    [base, spacing, 1],
    [base / 2, spacing, -1],
  ];
  // Remote bodies: hatch fills in toward the poles, so the flat map reads as a sphere.
  const poleLift = (y: number) => {
    if (!remote) return 0;
    const lat = Math.abs(y - height / 2) / (height / 2);
    const k = Math.max(0, (lat - 0.55) / 0.45);
    return 3 * k * k;
  };
  const hatch: [Pt, Pt][] = [];
  for (const [limit, step, dir] of passes) {
    for (let off = -height; off < width; off += step) {
      let run: Pt[] = [];
      const flush = () => {
        if (run.length > 1 && pathLength(run) > 10) {
          hatch.push([run[0], run[run.length - 1]]);
        }
        run = [];
      };
      for (let t = 0; t < diag; t += 4) {
        const x = off + t;
        const y = dir === 1 ? t : height - t;
        if (x < 0 || x >= width || y < 0 || y >= height) {
          flush();
          continue;
        }
        const lim = dir === 1 ? limit + poleLift(y) : limit + poleLift(y) * 0.6;
        if (norm(x, y) < lim) run.push([x, y]);
        else flush();
      }
      flush();
    }
  }

  const m = 8;
  const frame: Pt[] | null = remote
    ? [
        [m, m],
        [width - m, m],
        [width - m, height - m],
        [m, height - m],
        [m, m],
      ]
    : null;
  return { coast, hatch, frame };
}

/**
 * Draws a pencil sketch of `image`, an equirectangular body texture, onto a new
 * canvas of `o.width` by `o.height`: coastlines in a bright ink, the dark ground
 * (seas, shadow) shaded with light hatching, and for a body too small to show
 * detail from home, a few loose rounded shapes in a frame. Useful for giving a
 * map a base that stays quiet under the craft, its track and the waypoints. Used
 * by the Ground Track. The same image, options and seed give the same picture.
 */
export function pencilSketch(
  image: CanvasImageSource,
  o: PencilOptions,
): HTMLCanvasElement {
  const { paper, coast, ink, hatch } = o.palette;
  const boost = Math.max(1, o.coastBoost ?? 1);
  const rnd = mulberry32(o.seed);
  const canvas = document.createElement("canvas");
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, o.width, o.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const d = Math.min(1, Math.max(0, o.detail));
  const { cols, rows } = fieldSize(d);
  const plan = planSketch(
    luminanceField(image, cols, rows),
    o.width,
    o.height,
    d,
  );
  const jitter = 1.6 + 1.8 * (1 - d);
  for (const px of plan.coast) {
    graphiteStroke(ctx, px, rnd, jitter, 1.6 * boost, 0.9, coast);
    graphiteStroke(ctx, px, rnd, jitter * 1.3, 1.2 * boost, 0.5, coast);
  }
  for (const run of plan.hatch)
    graphiteStroke(ctx, run, rnd, 1.1, 0.9, 0.5, hatch);
  if (plan.frame) {
    graphiteStroke(ctx, plan.frame, rnd, 1.8, 1.5, 0.8, ink);
    graphiteStroke(ctx, plan.frame, rnd, 2.4, 1.1, 0.45, ink);
  }
  return canvas;
}
