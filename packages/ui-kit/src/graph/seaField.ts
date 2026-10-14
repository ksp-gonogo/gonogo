/**
 * A sea surface as a sum of a few directional waves, each running at the speed deep water gives it on the body's own gravity (omega squared = g k).
 *
 * The waves are an octave ladder below a long swell, with heights from a JONSWAP-shaped spectrum: past the peak every octave is about equally steep, which is why a real sea looks alike at every scale, and longer than the peak the sea has almost nothing. Each octave keeps its own direction and phase whatever the zoom, and how much of it shows is a smooth function of how many metres a pixel spans, so as a window closes in finer waves fade in and coarser ones fade out with nothing popping.
 *
 * Shading comes from the surface normal alone: lighter where a slope faces the light, darker where it faces away, and a glint where it mirrors the light toward the viewer. Pure functions, so a still frame at a given time is the same frame every time.
 */

/** The longest swell the spectrum peaks at, metres: a long ocean swell. */
const PEAK_WAVELENGTH_M = 400;
/** Octaves of wave below the peak, and one above it, that the ladder holds. */
const OCTAVES_BELOW_PEAK = 16;
/** The most waves summed for one frame. */
export const MAX_COMPONENTS = 8;
/** How steep each octave past the peak is, crest height times wavenumber: quiet, so the sea never reads as relief. */
const OCTAVE_STEEPNESS = 0.06;
/** JONSWAP's peak enhancement. */
const PEAK_ENHANCEMENT = 3.3;
/** Gerstner chop: how far the crests sharpen, 0 for plain sine waves. */
const CHOP = 0.6;
/** The direction the sea runs, degrees clockwise from north, and how far each octave strays from it either way. */
const SEA_HEADING_DEG = 60;
const SPREAD_DEG = 40;

/**
 * The band of wavelengths a frame shows, in pixels: a wave fades in from 6 pixels to 12, and out again from 48 to 96, so about three octaves show at once. Every wave is fixed in metres, so it grows on screen as a window closes until it fades, and finer ones come in below it, as terrain does.
 */
const FADE_IN_PX = [6, 12] as const;
const FADE_OUT_PX = [48, 96] as const;
/** Waves per octave, each on its own heading: a ladder of half octaves, so the band (four octaves) holds at most eight waves and none is ever dropped to keep to the cap, which would pop. */
const PER_OCTAVE = 2;

export interface SeaWave {
  /** Wavenumber along east and north, radians per metre. */
  kx: number;
  ky: number;
  k: number;
  /** Crest height, metres. */
  amplitude: number;
  /** Angular frequency, radians per second. */
  omega: number;
  phase: number;
  /** How much of the wave this zoom shows, 0 to 1. */
  weight: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A number in [0, 1) for each octave, so every octave keeps its direction and phase at every zoom. */
function scatter(octave: number, salt: number): number {
  const s = Math.sin(octave * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** JONSWAP's shape at angular frequency `omega`, peak `omegaPeak`, relative to its value at the peak. */
function jonswap(omega: number, omegaPeak: number): number {
  const r = omegaPeak / omega;
  const sigma = omega <= omegaPeak ? 0.07 : 0.09;
  const peak =
    PEAK_ENHANCEMENT **
    Math.exp(-((omega - omegaPeak) ** 2) / (2 * sigma ** 2 * omegaPeak ** 2));
  return r ** 5 * Math.exp(-1.25 * r ** 4) * peak;
}

/**
 * The waves a window shows at `metresPerPixel`: at most `MAX_COMPONENTS`, each weighted by where its wavelength falls in the band a pixel that size can show, and never longer than the window `spanMeters` wide.
 */
export function seaWaves(
  metresPerPixel: number,
  spanMeters: number,
  gravity: number,
): SeaWave[] {
  if (
    !(metresPerPixel > 0) ||
    !(spanMeters > 0) ||
    !(gravity > 0) ||
    !Number.isFinite(metresPerPixel + spanMeters + gravity)
  ) {
    return [];
  }
  const omegaPeak = Math.sqrt((gravity * 2 * Math.PI) / PEAK_WAVELENGTH_M);
  const atPeak = jonswap(omegaPeak, omegaPeak);
  const waves: SeaWave[] = [];
  for (let id = -PER_OCTAVE; id <= OCTAVES_BELOW_PEAK * PER_OCTAVE; id++) {
    const wavelength = PEAK_WAVELENGTH_M / 2 ** (id / PER_OCTAVE);
    const pixels = wavelength / metresPerPixel;
    const weight =
      smoothstep(FADE_IN_PX[0], FADE_IN_PX[1], pixels) *
      (1 - smoothstep(FADE_OUT_PX[0], FADE_OUT_PX[1], pixels)) *
      (1 - smoothstep(spanMeters, 2 * spanMeters, wavelength));
    if (weight <= 0.001) continue;
    const k = (2 * Math.PI) / wavelength;
    const omega = Math.sqrt(gravity * k);
    // Past the peak every octave is about as steep as the next; the spectrum's own shape takes the swell's octave down from there.
    const shape = Math.sqrt(Math.min(1, jonswap(omega, omegaPeak) / atPeak));
    const steep =
      (omega >= omegaPeak ? OCTAVE_STEEPNESS : OCTAVE_STEEPNESS * shape) /
      Math.sqrt(PER_OCTAVE);
    const heading =
      ((SEA_HEADING_DEG + (scatter(id, 1) - 0.5) * 2 * SPREAD_DEG) * Math.PI) /
      180;
    waves.push({
      kx: k * Math.sin(heading),
      ky: k * Math.cos(heading),
      k,
      amplitude: steep / k,
      omega,
      phase: scatter(id, 2) * 2 * Math.PI,
      weight,
    });
  }
  // The band holds at most the cap; the slice only guards a band widened past it.
  return waves.slice(0, MAX_COMPONENTS);
}

/** The surface's height above still water, metres, at a point east and north of the body's origin. */
export function seaHeight(
  waves: readonly SeaWave[],
  east: number,
  north: number,
  seconds: number,
): number {
  let h = 0;
  for (const w of waves) {
    h +=
      w.weight *
      w.amplitude *
      Math.cos(w.kx * east + w.ky * north - w.omega * seconds + w.phase);
  }
  return h;
}

/** The light the sea is shaded by, from the north-west and high: lighter on slopes facing it, and near enough overhead that an ordinary crest can mirror it. */
const LIGHT = normalise(-0.25, 0.3, 0.92);
/** How much a slope facing the light, or away from it, lightens or darkens the water. */
const FACING_GAIN = 2.6;
/** Halfway between the light and a viewer looking straight down: where the normal meets it, the surface mirrors the light. */
const HALF = normalise(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
/** How strongly a wave's height swells and fades with its partner's, and which wave of the set, counted on from it, is its partner. */
const GROUPING = 0.8;
const GROUP_PARTNER = 3;
/** Below this the mirror term is too weak to glint, so it is not raised to its power. */
const GLINT_FROM = 0.95;
const GLINT_STRENGTH = 0.35;
/** How opaque the water is over what it covers, 0 to 255: deep water hides the floor. */
const WATER_ALPHA = 235;
/** Open water is a deeper shade of the water's own colour, so the sea sits quietly under the marks. */
const DEEP_SHADE = 0.5;
/** How far a slope facing the light lifts the water toward white. */
const HIGHLIGHT_MIX = 0.35;

function normalise(x: number, y: number, z: number): [number, number, number] {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

/** The water's colour, 0 to 255 each. */
export interface SeaColour {
  r: number;
  g: number;
  b: number;
}

/**
 * Shades a plan view into `pixels`, RGBA row-major from the top, `width` by `height`. Pixel (i, j) stands at `east0 + (i + 0.5) * dx` east and `north0 - (j + 0.5) * dy` north. `isSea(i, j)`, when given, leaves land transparent.
 */
export function shadePlan(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  view: {
    east0: number;
    north0: number;
    dx: number;
    dy: number;
    seconds: number;
    colour: SeaColour;
    waves: readonly SeaWave[];
    isSea?: (i: number, j: number) => boolean;
  },
): void {
  const { east0, north0, dx, dy, seconds, colour, waves, isSea } = view;
  const [lx, ly, lz] = LIGHT;
  const [hx, hy, hz] = HALF;
  const n = waves.length;
  // A wave's phase is an east part plus a north part, so its cosine and sine at every pixel come from one table per column and one per row, by the angle-sum rule: the trigonometry is per column and per row, never per pixel.
  const colCos = new Float64Array(n * width);
  const colSin = new Float64Array(n * width);
  const rowCos = new Float64Array(n * height);
  const rowSin = new Float64Array(n * height);
  for (let w = 0; w < n; w++) {
    const wave = waves[w];
    for (let i = 0; i < width; i++) {
      const a = wave.kx * (east0 + (i + 0.5) * dx);
      colCos[w * width + i] = Math.cos(a);
      colSin[w * width + i] = Math.sin(a);
    }
    for (let j = 0; j < height; j++) {
      const b =
        wave.ky * (north0 - (j + 0.5) * dy) - wave.omega * seconds + wave.phase;
      rowCos[w * height + j] = Math.cos(b);
      rowSin[w * height + j] = Math.sin(b);
    }
  }
  const cosAt = new Float64Array(n);
  const sinAt = new Float64Array(n);
  const slopeX = waves.map((w) => w.kx * w.weight * w.amplitude);
  const slopeY = waves.map((w) => w.ky * w.weight * w.amplitude);
  const chop = waves.map((w) => CHOP * w.k * w.weight * w.amplitude);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const o = (j * width + i) * 4;
      if (isSea && !isSea(i, j)) {
        pixels[o + 3] = 0;
        continue;
      }
      // A Gerstner surface's normal: the slopes tip it, the chop shortens it under the crests.
      let nx = 0;
      let ny = 0;
      let nz = 1;
      for (let w = 0; w < n; w++) {
        const ca = colCos[w * width + i];
        const sa = colSin[w * width + i];
        const cb = rowCos[w * height + j];
        const sb = rowSin[w * height + j];
        cosAt[w] = ca * cb - sa * sb;
        sinAt[w] = sa * cb + ca * sb;
      }
      for (let w = 0; w < n; w++) {
        // Waves come in groups: each rides on another of the set, which crosses it into sum and difference waves no single sine has, so a handful never reads as a printed weave.
        const group = n > 1 ? 1 + GROUPING * cosAt[(w + GROUP_PARTNER) % n] : 1;
        nx -= slopeX[w] * cosAt[w] * group;
        ny -= slopeY[w] * cosAt[w] * group;
        nz -= chop[w] * sinAt[w] * group;
      }
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const facing = (nx * lx + ny * ly + nz * lz) * inv - lz;
      const light = 1 + FACING_GAIN * facing;
      let glint = 0;
      const mirror = (nx * hx + ny * hy + nz * hz) * inv;
      if (mirror > GLINT_FROM) {
        // The mirror term to the 128th power, by squaring: a glint only where the slope all but mirrors the light.
        let g = mirror;
        for (let k = 0; k < 7; k++) g *= g;
        glint = 255 * GLINT_STRENGTH * g;
      }
      // A slope facing away darkens the water; one facing the light mixes it toward white, so the hue holds instead of one channel clipping first.
      const toWhite = Math.max(0, light - 1) * HIGHLIGHT_MIX;
      const shade = Math.min(1, light) * DEEP_SHADE;
      pixels[o] = colour.r * shade + (255 - colour.r * shade) * toWhite + glint;
      pixels[o + 1] =
        colour.g * shade + (255 - colour.g * shade) * toWhite + glint;
      pixels[o + 2] =
        colour.b * shade + (255 - colour.b * shade) * toWhite + glint;
      pixels[o + 3] = WATER_ALPHA;
    }
  }
}

/** Relative luminance of a colour, 0 to 1, as WCAG reckons it. */
export function luminanceOf(c: SeaColour): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * A body's own liquid colour at the brightness of the theme's water: its hue kept, its luminance the water token's, so a purple sea or a slate one stands as quietly under the marks as the theme's own water does, on any theme. Where the colour cannot be lifted that far without a channel clipping, it is lifted as far as it goes.
 */
export function liquidShade(liquid: SeaColour, water: SeaColour): SeaColour {
  const target = luminanceOf(water);
  const brightest = Math.max(liquid.r, liquid.g, liquid.b, 1);
  const scaled = (k: number): SeaColour => ({
    r: Math.min(255, liquid.r * k),
    g: Math.min(255, liquid.g * k),
    b: Math.min(255, liquid.b * k),
  });
  let lo = 0;
  let hi = 255 / brightest;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (luminanceOf(scaled(mid)) < target) lo = mid;
    else hi = mid;
  }
  const out = scaled((lo + hi) / 2);
  return { r: Math.round(out.r), g: Math.round(out.g), b: Math.round(out.b) };
}
