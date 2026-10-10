import { latLonToMap, predictGroundTrack } from "@ksp-gonogo/core";
import {
  type OrbitPatch,
  TransitionType,
  wrapTypePayload,
} from "@ksp-gonogo/sitrep-sdk";
import { splitAtPoleCrossings, wrapPath } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import munPolarOrbit from "./__fixtures__/mun-polar-orbit.json";

/**
 * An inclined pass leaving the map at the right edge and returning at the
 * left, on a body whose texture is rotated 90 degrees: the drawn seam is at
 * body longitude 90, between the 85 and 95 samples, and the propagated one
 * between 175 and -175. Latitudes are far from zero so a spurious full-width
 * line cannot hide on an equatorial track.
 */
const PASS = [
  { lon: 65, lat: -27.9 },
  { lon: 75, lat: -27.0 },
  { lon: 85, lat: -25.4 },
  { lon: 95, lat: -23.0 },
  { lon: 175, lat: 8.4 },
  { lon: -175, lat: 10.1 },
];

const WORLD = 360;

/** MapView's projection: rotated by the body's texture offset, then wrapped into one world. */
function drawn(lat: number, lon: number, offsetDeg: number) {
  const wrapped = ((((lon + offsetDeg + 180) % 360) + 360) % 360) - 180;
  return latLonToMap(lat, wrapped, WORLD, WORLD / 2);
}

describe("a ground track across the antimeridian", () => {
  it.each([
    0, 90,
  ])("never strokes across the map, with the texture rotated %s degrees", (offset) => {
    const projected = PASS.map((p) => drawn(p.lat, p.lon, offset));
    const copies = wrapPath(projected, WORLD, 0, WORLD);
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      for (let i = 1; i < copy.length; i++)
        expect(Math.abs(copy[i].x - copy[i - 1].x)).toBeLessThan(WORLD / 4);
    }
  });

  it("is drawn on both sides of the seam, so it leaves one edge and enters the other", () => {
    const projected = PASS.map((p) => drawn(p.lat, p.lon, 90));
    const copies = wrapPath(projected, WORLD, 0, WORLD);
    expect(copies).toHaveLength(2);
    const reaches = (edge: number) =>
      copies.some((copy) =>
        copy.some((p, i) => i > 0 && (copy[i - 1].x - edge) * (p.x - edge) < 0),
      );
    expect(reaches(0)).toBe(true);
    expect(reaches(WORLD)).toBe(true);
  });

  it("is one run: only a pole breaks the line", () => {
    expect(splitAtPoleCrossings(PASS)).toEqual([PASS]);
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

describe("a ground track over a pole", () => {
  const samples = munPolarSamples();

  it("still has its south crossing, a jump just short of half a turn", () => {
    const { before, after } = southPoleStraddle(samples);
    expect({
      jump: Number(Math.abs(after.lon - before.lon).toFixed(2)),
      lat: [Number(before.lat.toFixed(2)), Number(after.lat.toFixed(2))],
    }).toEqual({ jump: 179.97, lat: [-89.1, -89.62] });
  });

  it("breaks the track at the south pole rather than stroking a bar along the bottom edge", () => {
    const segments = splitAtPoleCrossings(samples);
    const { before, after } = southPoleStraddle(samples);
    const segmentOf = (p: { lat: number; lon: number }) =>
      segments.findIndex((s) => s.some((q) => q.lat === p.lat));
    expect(segmentOf(before)).not.toBe(segmentOf(after));
  });

  it("breaks at both poles and nowhere else, so each pass stays whole", () => {
    const segments = splitAtPoleCrossings(samples);
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
    expect(splitAtPoleCrossings(inclined)).toEqual([inclined]);
  });
});
