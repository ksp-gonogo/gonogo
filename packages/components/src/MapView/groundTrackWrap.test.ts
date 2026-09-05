import {
  type OrbitPatch,
  predictGroundTrack,
  splitOnLongitudeWrap,
} from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import munPolarOrbit from "./__fixtures__/mun-polar-orbit.json";
import { splitOnDrawnLongitudeWrap } from "./groundTrackWrap";

/**
 * An inclined pass that leaves the map at the right edge and comes back at the
 * left, drawn on a body whose texture is rotated 90 degrees.
 *
 * Kerbin's offset means the drawn seam is at body longitude 90, so the break
 * belongs between the 85 and 95 samples. Their latitudes are far from zero on
 * purpose: the whole reason this went unnoticed is that a spurious full-width
 * line at latitude zero is indistinguishable from an equatorial track.
 */
const PASS = [
  { lon: 65, lat: -27.9 },
  { lon: 75, lat: -27.0 },
  { lon: 85, lat: -25.4 },
  { lon: 95, lat: -23.0 },
  { lon: 175, lat: 8.4 },
  { lon: -175, lat: 10.1 },
];

const KERBIN_LONGITUDE_OFFSET = 90;

describe("splitOnDrawnLongitudeWrap", () => {
  it("breaks the track where the drawing wraps, not where the propagation does", () => {
    const segments = splitOnDrawnLongitudeWrap(PASS, KERBIN_LONGITUDE_OFFSET);
    expect(segments.map((s) => s.map((p) => p.lon))).toEqual([
      [65, 75, 85],
      [95, 175, -175],
    ]);
  });

  it("is the same split as the plain one when the body's texture is not rotated", () => {
    expect(splitOnDrawnLongitudeWrap(PASS, 0)).toEqual(
      splitOnLongitudeWrap(PASS),
    );
  });

  /*
   * The bug, stated as the thing that used to happen: reading the propagated
   * longitude puts the break at 175 -> -175, so the pair straddling the drawn
   * seam (85 -> 95, at latitude -25) stays inside one segment and is stroked
   * as one line across the entire map.
   */
  it("keeps the pair the old split let through in separate segments", () => {
    const unfixed = splitOnLongitudeWrap(PASS);
    expect(unfixed[0].map((p) => p.lon)).toContain(85);
    expect(unfixed[0].map((p) => p.lon)).toContain(95);

    const fixed = splitOnDrawnLongitudeWrap(PASS, KERBIN_LONGITUDE_OFFSET);
    const segmentOf = (lon: number) =>
      fixed.findIndex((s) => s.some((p) => p.lon === lon));
    expect(segmentOf(85)).not.toBe(segmentOf(95));
  });
});

/**
 * The pole half, driven off the real `mun-polar-orbit` fixture rather than a
 * hand-built pass, because the numbers are the point: the south crossing jumps
 * 179.97 degrees of longitude, and a seam split written as `> 180` misses it by
 * three hundredths of a degree.
 */
const MUN = { radius: 200000, rotationPeriod: 138984.376574476 } as const;

/**
 * The wire fields the fixture's `vessel.orbit` patch carries, as a shape the
 * emits array can be read through: enough to build an `OrbitPatch` field by
 * field, rather than asserting one out of the JSON.
 */
interface WirePatch {
  sma: number;
  ecc: number;
  inc: number;
  lan: number;
  argPe: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
  period: number;
  startUt: number;
  endUt: number;
  peA: number;
  apA: number;
  semiLatusRectum: number;
  semiMinorAxis: number;
  referenceBody: string;
}

const FIXTURE: {
  "t.universalTime": number;
  "v.lat": number;
  "v.long": number;
  _stream: { emits: { channel: string; value: { patches?: WirePatch[] } }[] };
} = munPolarOrbit;

function munPolarSamples(
  inclinationDeg?: number,
): { ut: number; lat: number; lon: number }[] {
  const wire = FIXTURE._stream.emits.find((e) => e.channel === "vessel.orbit")
    ?.value.patches;
  if (!wire) throw new Error("mun-polar-orbit carries no orbit patches");
  const patches: OrbitPatch[] = wire.map((p) => ({
    startUT: p.startUt,
    endUT: p.endUt,
    patchStartTransition: "INITIAL",
    patchEndTransition: "FINAL",
    PeA: p.peA,
    ApA: p.apA,
    epoch: p.epoch,
    period: p.period,
    sma: p.sma,
    eccentricity: p.ecc,
    // The one field a caller may vary: everything else stays the fixture's.
    inclination: inclinationDeg ?? p.inc,
    lan: p.lan,
    argumentOfPeriapsis: p.argPe,
    maae: p.meanAnomalyAtEpoch,
    referenceBody: p.referenceBody,
    semiLatusRectum: p.semiLatusRectum,
    semiMinorAxis: p.semiMinorAxis,
    closestEncounterBody: null,
  }));
  const ref = {
    ut: FIXTURE["t.universalTime"],
    lat: FIXTURE["v.lat"],
    lon: FIXTURE["v.long"],
  };
  // The horizon MapView itself asks for: 1.5 periods, sampled every 10 s.
  return predictGroundTrack(
    patches,
    "Mun",
    MUN.radius,
    MUN.rotationPeriod,
    ref,
    1.5 * patches[0].period,
    10,
  );
}

/** The consecutive pair whose great-circle path runs over the south pole. */
function southPoleStraddle(samples: readonly { lat: number; lon: number }[]): {
  before: { lat: number; lon: number };
  after: { lat: number; lon: number };
} {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.lat < -85 && b.lat < -85 && Math.abs(b.lon - a.lon) > 90)
      return { before: a, after: b };
  }
  throw new Error("mun-polar-orbit no longer crosses the south pole");
}

describe("splitOnDrawnLongitudeWrap over a pole", () => {
  const samples = munPolarSamples();

  it("still has the south crossing the seam split cannot see", () => {
    const { before, after } = southPoleStraddle(samples);
    expect({
      jump: Number(Math.abs(after.lon - before.lon).toFixed(2)),
      lat: [Number(before.lat.toFixed(2)), Number(after.lat.toFixed(2))],
    }).toEqual({ jump: 179.97, lat: [-89.1, -89.62] });
  });

  it("breaks the track at the south pole rather than stroking a bar along the bottom edge", () => {
    // The Mun's texture is not rotated, so the drawn longitude is the
    // propagated one and the seam split has nothing of its own to do here.
    const segments = splitOnDrawnLongitudeWrap(samples, 0);
    const { before, after } = southPoleStraddle(samples);
    const segmentOf = (p: { lat: number; lon: number }) =>
      segments.findIndex((s) => s.some((q) => q.lat === p.lat));
    expect(segmentOf(before)).not.toBe(segmentOf(after));
  });

  it("breaks at both poles and nowhere else, so each pass stays whole", () => {
    const segments = splitOnDrawnLongitudeWrap(samples, 0);
    // Two crossings in 1.5 revolutions of a polar orbit: one north, one south.
    expect(segments.length).toBe(3);
    expect(segments.reduce((n, s) => n + s.length, 0)).toBe(samples.length);
    // No segment may contain a drawn line long enough to read as a bar: the
    // craft covers well under a degree of arc in the 10 s between samples.
    const widest = Math.max(
      ...segments.flatMap((s) =>
        s.slice(1).map((p, i) => Math.abs(p.lon - s[i].lon)),
      ),
    );
    expect(widest).toBeLessThan(90);
  });

  /*
   * The guard against the cheap fix. A break taken on latitude alone, or on a
   * lowered longitude threshold, would cut these tracks too, and a pass lost to
   * an over-eager split is worse than the bar. The same orbit at 60 through 88
   * degrees reaches high latitude and jogs across longitude at the top of each
   * pass, but never passes nearer the pole than one sample step, so the
   * straight line between its samples is the path and stays whole.
   *
   * 88 is the one that bites: it swings 35.6 degrees of longitude in a single
   * 10 s step over the top, so every threshold between 36 and 180 splits it,
   * and 36 is what a threshold tuned to catch this fixture's 179.97 would have
   * to be nowhere near.
   */
  it.each([
    60, 75, 80, 88,
  ])("leaves a %s degree inclination alone: high latitude is not a pole crossing", (inclination) => {
    const inclined = munPolarSamples(inclination);
    expect(Math.max(...inclined.map((p) => Math.abs(p.lat)))).toBeGreaterThan(
      inclination - 1,
    );
    // One break, and it is the date line: the same answer as before the pole
    // rule existed.
    expect(splitOnDrawnLongitudeWrap(inclined, 0)).toEqual(
      splitOnLongitudeWrap(inclined),
    );
  });
});
