import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import { type OrbitSample, pastTrack } from "./past-track";

const MU = 3.5316e12;

/**
 * A TILTED, rotated, non-circular orbit, and every one of those three matters.
 *
 * <p>This fixture was `inc = lan = argPe = 0` for every test in the file. In
 * that orbit the body-centred inertial frame and the orbit's own perifocal frame
 * are the SAME frame, and periapsis is wherever you like because the orbit is a
 * circle. So a trail solved into the wrong one of those frames came out
 * identical to a trail solved into the right one, every assertion here passed,
 * and the frame the points were in was never under test at all. The angles below
 * are what make the difference between the two frames visible.</p>
 */
function sample(
  validAt: number,
  over: Partial<Record<string, unknown>> = {},
): OrbitSample {
  return {
    validAt,
    payload: {
      sma: value("m", 700_000),
      ecc: value("1", 0.2),
      inc: value("°", 35),
      lan: value("°", 70),
      argPe: value("°", 40),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 0),
      mu: value("m³/s²", MU),
      referenceBodyIndex: 1,
      ...over,
    } as OrbitSample["payload"],
  };
}

/** The elements the trail is expressed against: the same ones, as the wire has them. */
function frame(): OrbitSample["payload"] {
  return sample(0).payload;
}

describe("where the craft has been", () => {
  it("places one point per sample, at that sample's own instant", () => {
    // The trail is a RECORD: each point comes from the elements that arrived
    // for that instant, not from running today's elements backwards. Under an
    // n-body model the path does not retrace, so a back-propagation would be a
    // different claim and a wrong one.
    const track = pastTrack([sample(0), sample(100), sample(200)], {
      frame: frame(),
    });

    expect(track.map((p) => p.ut)).toEqual([0, 100, 200]);
  });

  it("moves the craft between samples rather than repeating a position", () => {
    // The check that this actually solved anything: two instants a long way
    // apart on a 700 km orbit are different places.
    const track = pastTrack([sample(0), sample(900)], { frame: frame() });

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
    const track = pastTrack(
      [sample(0), sample(100, { ecc: value("1", 1.4) })],
      {
        frame: frame(),
      },
    );

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
      { frame: frame(), centreBodyIndex: 1 },
    );

    expect(track.map((p) => p.ut)).toEqual([200, 300]);
  });

  it("keeps every sample when no centre is named", () => {
    // The contrast: the drop above is the CENTRE check firing, not the samples
    // being unusable.
    const track = pastTrack(
      [
        sample(0, { referenceBodyIndex: 5 }),
        sample(100, { referenceBodyIndex: 1 }),
      ],
      { frame: frame() },
    );

    expect(track).toHaveLength(2);
  });

  it("answers an empty track for no samples rather than throwing", () => {
    expect(pastTrack([], { frame: frame() })).toEqual([]);
  });
});

describe("the points are real places", () => {
  it("never emits a non-finite coordinate", () => {
    // The guard that catches an accessor reading the wrong shape. A NaN
    // coordinate does not throw, does not draw, and passes any assertion
    // written as a comparison, because every comparison against NaN is false:
    // six tests here were green over a function returning nothing but NaN.
    const track = pastTrack([sample(0), sample(450), sample(900)], {
      frame: frame(),
    });

    expect(track).toHaveLength(3);
    for (const p of track) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });

  it("places a circular orbit's points at its own radius", () => {
    // Independently checkable: a 700 km circular orbit puts every point 700 km
    // from the centre, whatever the instant. A wrong unit or a wrong anomaly
    // fails this, and neither would look wrong on a diagram. Circular ON PURPOSE
    // here and nowhere else in the file: the invariant only holds for a circle,
    // and it is a distance, which is the one property every frame agrees on.
    const circular = { ecc: value("1", 0) };
    const track = pastTrack(
      [sample(0, circular), sample(450, circular), sample(900, circular)],
      { frame: sample(0, circular).payload },
    );

    for (const p of track) {
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(700_000, -1);
    }
  });
});

/**
 * The frame the points come out in, which is the property the degenerate fixture
 * could not express and the reason this describe exists.
 *
 * <p>The trail is drawn beside a forward arc on the same diagram, and that arc
 * is expressed in the orbit's own PERIFOCAL frame: the plane of the orbit, with
 * periapsis on +x. A trail handed back in the body-centred inertial frame draws
 * a second curve, of the right shape and the right size, rotated away from the
 * one the craft is on by the orbit's own three angles. On a tilted orbit it
 * leaves the plane entirely. Nothing about it looks like an error.</p>
 */
describe("the frame the trail is expressed in", () => {
  it("puts every point in the plane the diagram draws", () => {
    // A closed orbit is flat, and in its own perifocal frame flat means z = 0.
    // In the inertial frame a 35-degree orbit's points are metres to hundreds of
    // kilometres out of that plane.
    const track = pastTrack([sample(0), sample(450), sample(900)], {
      frame: frame(),
    });

    expect(track).toHaveLength(3);
    for (const p of track) {
      expect(Math.abs(p.z)).toBeLessThan(1);
    }
  });

  it("puts periapsis on the +x axis, where the diagram's is", () => {
    // At the epoch the mean anomaly is zero, so the craft is AT periapsis. In
    // the perifocal frame that is one specific place: (a(1-e), 0, 0). In the
    // inertial frame, with this orbit's lan and argPe, it is somewhere else
    // entirely, and both are 560 km from the centre.
    const [at] = pastTrack([sample(0)], { frame: frame() });

    expect(at.x).toBeCloseTo(700_000 * (1 - 0.2), -1);
    expect(Math.abs(at.y)).toBeLessThan(1);
  });
});
