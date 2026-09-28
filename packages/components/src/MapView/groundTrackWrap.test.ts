import { predictGroundTrack, splitOnLongitudeWrap } from "@ksp-gonogo/core";
import {
  type OrbitPatch,
  TransitionType,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import munPolarOrbit from "./__fixtures__/mun-polar-orbit.json";
import { splitOnDrawnLongitudeWrap } from "./groundTrackWrap";

/**
 * An inclined pass leaving the map at the right edge and returning at the
 * left, on a body whose texture is rotated 90 degrees: the drawn seam is at
 * body longitude 90, so the break belongs between the 85 and 95 samples.
 * Latitudes are far from zero so a spurious full-width line cannot hide on an
 * equatorial track.
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

  // Splitting on propagated longitude would leave the 85 -> 95 pair in one segment, stroked across the whole map.
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

// The real `mun-polar-orbit` fixture: its south crossing jumps 179.97 degrees, which a `> 180` seam split misses.
const MUN = { radius: 200000, rotationPeriod: 138984.376574476 } as const;

/** The wire fields of the fixture's `vessel.orbit` patch, enough to decode an `OrbitPatch`. */
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
  const patches = wire.map((p) =>
    wrapTypePayload<OrbitPatch>("OrbitPatch", {
      ...p,
      patchStartTransition: TransitionType.Initial,
      patchEndTransition: TransitionType.Final,
      // The one field a caller may vary.
      inc: inclinationDeg ?? p.inc,
    }),
  );
  const ref = {
    ut: FIXTURE["t.universalTime"],
    lat: FIXTURE["v.lat"],
    lon: FIXTURE["v.long"],
  };
  // The horizon MapView asks for: 1.5 periods, sampled every 10 s.
  return predictGroundTrack(
    patches,
    "Mun",
    MUN.radius,
    MUN.rotationPeriod,
    ref,
    1.5 * wire[0].period,
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
    // The Mun's texture is not rotated, so the seam split has nothing of its own to do.
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
    // No drawn line long enough to read as a bar: the craft covers well under a degree between samples.
    const widest = Math.max(
      ...segments.flatMap((s) =>
        s.slice(1).map((p, i) => Math.abs(p.lon - s[i].lon)),
      ),
    );
    expect(widest).toBeLessThan(90);
  });

  /*
   * A split on latitude or a lowered longitude threshold would also cut these
   * tracks. At 60 through 88 degrees the orbit jogs across longitude at the
   * top of each pass but never nearer the pole than one sample step, so it
   * stays whole. 88 swings 35.6 degrees in one step, so every threshold
   * between 36 and 180 would split it.
   */
  it.each([
    60, 75, 80, 88,
  ])("leaves a %s degree inclination alone: high latitude is not a pole crossing", (inclination) => {
    const inclined = munPolarSamples(inclination);
    expect(Math.max(...inclined.map((p) => Math.abs(p.lat)))).toBeGreaterThan(
      inclination - 1,
    );
    // One break, at the date line.
    expect(splitOnDrawnLongitudeWrap(inclined, 0)).toEqual(
      splitOnLongitudeWrap(inclined),
    );
  });
});
