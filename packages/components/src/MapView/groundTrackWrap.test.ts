import { splitOnLongitudeWrap } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
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
