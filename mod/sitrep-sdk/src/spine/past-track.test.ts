import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import { type OrbitSample, pastTrack } from "./past-track";

const MU = 3.5316e12;

function sample(
  validAt: number,
  over: Partial<Record<string, unknown>> = {},
): OrbitSample {
  return {
    validAt,
    payload: {
      sma: value("m", 700_000),
      ecc: value("1", 0),
      inc: value("°", 0),
      lan: value("°", 0),
      argPe: value("°", 0),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 0),
      mu: value("m³/s²", MU),
      referenceBodyIndex: 1,
      ...over,
    } as OrbitSample["payload"],
  };
}

describe("where the craft has been", () => {
  it("places one point per sample, at that sample's own instant", () => {
    // The trail is a RECORD: each point comes from the elements that arrived
    // for that instant, not from running today's elements backwards. Under an
    // n-body model the path does not retrace, so a back-propagation would be a
    // different claim and a wrong one.
    const track = pastTrack([sample(0), sample(100), sample(200)]);

    expect(track.map((p) => p.ut)).toEqual([0, 100, 200]);
  });

  it("moves the craft between samples rather than repeating a position", () => {
    // The check that this actually solved anything: two instants a long way
    // apart on a 700 km orbit are different places.
    const track = pastTrack([sample(0), sample(900)]);

    // A real separation in metres, not a float comparison: `toBeCloseTo` on
    // numbers this large passes for values hundreds of kilometres apart, so it
    // could not tell a solved trail from one solved at a single instant.
    const apart = Math.hypot(
      track[1].x - track[0].x,
      track[1].y - track[0].y,
      track[1].z - track[0].z,
    );
    expect(apart).toBeGreaterThan(100_000);
  });

  it("drops a sample it cannot place rather than guessing one", () => {
    // An escape trajectory has no closed solution here. A point invented for it
    // would sit somewhere plausible on a diagram and mean nothing.
    const track = pastTrack([sample(0), sample(100, { ecc: value("1", 1.4) })]);

    expect(track.map((p) => p.ut)).toEqual([0]);
  });

  it("starts the trail at a change of reference body, not across it", () => {
    // Samples about two different bodies are in two different frames. Joining
    // them draws a line across the gap between the bodies, which is a path the
    // craft never flew.
    // The mismatch sits in the MIDDLE on purpose. With it first, skipping the
    // sample and restarting the trail give the same answer, and the test proves
    // nothing: what has to be shown is that points ALREADY collected before a
    // transition are dropped, not carried across it.
    const track = pastTrack(
      [
        sample(0, { referenceBodyIndex: 1 }),
        sample(100, { referenceBodyIndex: 5 }),
        sample(200, { referenceBodyIndex: 1 }),
        sample(300, { referenceBodyIndex: 1 }),
      ],
      { centreBodyIndex: 1 },
    );

    expect(track.map((p) => p.ut)).toEqual([200, 300]);
  });

  it("keeps every sample when no centre is named", () => {
    // The contrast: the drop above is the CENTRE check firing, not the samples
    // being unusable.
    const track = pastTrack([
      sample(0, { referenceBodyIndex: 5 }),
      sample(100, { referenceBodyIndex: 1 }),
    ]);

    expect(track).toHaveLength(2);
  });

  it("answers an empty track for no samples rather than throwing", () => {
    expect(pastTrack([])).toEqual([]);
  });
});

describe("the points are real places", () => {
  it("never emits a non-finite coordinate", () => {
    // The guard that catches an accessor reading the wrong shape. A NaN
    // coordinate does not throw, does not draw, and passes any assertion
    // written as a comparison, because every comparison against NaN is false:
    // six tests here were green over a function returning nothing but NaN.
    const track = pastTrack([sample(0), sample(450), sample(900)]);

    expect(track).toHaveLength(3);
    for (const p of track) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });

  it("places a circular orbit's points at its own radius", () => {
    // Independently checkable: a 700 km circular orbit puts every point 700 km
    // from the centre, whatever the instant. A wrong frame, a wrong unit or a
    // wrong anomaly all fail this, and none of them would look wrong on a
    // diagram.
    for (const p of pastTrack([sample(0), sample(450), sample(900)])) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(700_000, -1);
    }
  });
});
