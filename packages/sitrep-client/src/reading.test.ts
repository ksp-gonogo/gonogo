import { describe, expect, it } from "vitest";
import {
  type Reading,
  type ReckonerFor,
  readingAge,
  readingFrom,
  withoutReckoning,
} from "./reading";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";

function point(validAt: number, payload: number | null): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

/**
 * A model that always has an answer, so the `reckonable` arm is reachable. It
 * covers the payload ROOT, which is what a whole-topic read needs: a model
 * naming only a sub-path has nothing to say about the payload as a whole.
 */
const alwaysReckons: ReckonerFor<number> = (p) => ({
  modelled: [{ path: "", basis: "linear-dead-reckoning" }],
  reckon: () => (p.payload ?? 0) + 1,
});

/** The frame view time every case here reads at, five seconds past the sample. */
const VIEW_UT = 15;

describe("readingFrom", () => {
  it("has no point yet, so the reading is pending", () => {
    expect(readingFrom(undefined, "resyncing", VIEW_UT)).toEqual({
      state: "pending",
    });
  });

  it("stays pending when the status is resyncing even though a point exists", () => {
    // A rewind past a topic's first frame: there IS buffered data, just none
    // at-or-before this view time. Reporting the value would show the operator
    // a sample from the future of what they are looking at.
    expect(readingFrom(point(10, 5), "resyncing", VIEW_UT)).toEqual({
      state: "pending",
    });
  });

  it("carries the observation time on a confirmed absence", () => {
    // "Confirmed nothing, as of when": what lets a widget say "no target set
    // (confirmed 3 s ago)" rather than asserting it for the rest of the mission.
    expect(readingFrom(point(10, null), "absent", VIEW_UT)).toEqual({
      state: "absent",
      atUt: 10,
    });
  });

  it("reports a live point as observed, with its observation time", () => {
    expect(readingFrom(point(10, 5), "live", VIEW_UT)).toEqual({
      state: "observed",
      value: 5,
      atUt: 10,
    });
  });

  it.each([
    "held-stale",
    "disconnected",
    "last-before-blackout",
  ] as const)("reports %s as stale with no reckoner, keeping the last real value", (status) => {
    expect(readingFrom(point(10, 5), status, VIEW_UT)).toEqual({
      state: "stale",
      grade: status,
      value: 5,
      asOfUt: 10,
    });
  });

  it("is stale, not reckonable, when the reckoner declines", () => {
    // The honest majority: most data can only be AGED. A declining reckoner and
    // no reckoner at all must be indistinguishable to a widget, so that
    // "nothing trustworthy can be said" has exactly one rendering.
    const declines: ReckonerFor<number> = () => undefined;
    expect(readingFrom(point(10, 5), "held-stale", VIEW_UT, declines)).toEqual({
      state: "stale",
      grade: "held-stale",
      value: 5,
      asOfUt: 10,
    });
  });

  it("is reckonable when a model exists, and still carries the real observation", () => {
    const reading = readingFrom(
      point(10, 5),
      "last-before-blackout",
      VIEW_UT,
      alwaysReckons,
    );
    expect(reading.state).toBe("reckonable");
    if (reading.state !== "reckonable") return;
    // The last REAL value, not the modelled one. A widget that wants "10% at
    // last contact" reads this; a widget that wants the propagated figure calls
    // `reckoned`. Neither is a substitute for the other.
    expect(reading.value).toBe(5);
    expect(reading.asOfUt).toBe(10);
    expect(reading.grade).toBe("last-before-blackout");
  });

  it("runs the model once per arm build, not once per read", () => {
    // Eager now: the model runs when the arm is built, which is once per frame
    // per topic actually read. What still matters is that READING the field is
    // free and gives one answer, so a widget wanting the number and the basis
    // and the age does not pay three times or risk three answers.
    let runs = 0;
    const counting: ReckonerFor<number> = (p) => ({
      modelled: [{ path: "", basis: "rate-integration" }],
      reckon: () => {
        runs += 1;
        return p.payload ?? 0;
      },
    });

    const reading = readingFrom(point(10, 5), "held-stale", VIEW_UT, counting);
    if (reading.state !== "reckonable") throw new Error("expected reckonable");
    expect(runs).toBe(1);
    void reading.reckoned;
    void reading.reckoned;
    expect(runs).toBe(1);
  });

  it("reckons a value FOR a later UT than the observation it came from", () => {
    const reading = readingFrom(
      point(10, 5),
      "held-stale",
      VIEW_UT,
      alwaysReckons,
    );
    if (reading.state !== "reckonable") throw new Error("expected reckonable");
    const reckoned = reading.reckoned;
    expect(reckoned).toEqual({
      value: 6,
      atUt: VIEW_UT,
      basis: "linear-dead-reckoning",
      modelled: [{ path: "", basis: "linear-dead-reckoning" }],
    });
    // The two UTs are different questions: when we last saw it, and what moment
    // the model is claiming about.
    expect(reckoned.atUt).toBeGreaterThan(reading.asOfUt);
  });

  it("degrades a stale-graded point with no payload to a confirmed absence", () => {
    // A tombstone that then went stale. The tombstone is the stronger claim and
    // there is no observed VALUE to carry, so neither stale arm can represent
    // it: `sampleRawStatus` already ranks `absent` above every staleness grade
    // for the same reason.
    expect(
      readingFrom(point(10, null), "held-stale", VIEW_UT, alwaysReckons),
    ).toEqual({
      state: "absent",
      atUt: 10,
    });
  });
});

describe("withoutReckoning", () => {
  it("collapses reckonable to stale, keeping the observation intact", () => {
    const reading = readingFrom(
      point(10, 5),
      "held-stale",
      VIEW_UT,
      alwaysReckons,
    );
    expect(withoutReckoning(reading)).toEqual({
      state: "stale",
      grade: "held-stale",
      value: 5,
      asOfUt: 10,
    });
  });

  it("leaves every other arm exactly as it was", () => {
    for (const reading of [
      readingFrom(undefined, "resyncing", VIEW_UT),
      readingFrom(point(10, null), "absent", VIEW_UT),
      readingFrom(point(10, 5), "live", VIEW_UT),
      readingFrom(point(10, 5), "held-stale", VIEW_UT),
    ]) {
      // Same object, not merely an equal one: a widget calling this on a live
      // reading must not pay a new identity for it.
      expect(withoutReckoning(reading)).toBe(reading);
    }
  });
});

describe("Reading, as a type", () => {
  it("cannot be read for a value without branching", () => {
    // The whole point of the union. This test is really the `@ts-expect-error`s:
    // they fail the build the day a value becomes reachable without writing the
    // discriminant, which is the property the sweep depends on.
    const pending: Reading<number> = { state: "pending" };
    // @ts-expect-error `pending` has no value at all, by design
    expect(pending.value).toBeUndefined();

    const absent: Reading<number> = { state: "absent", atUt: 10 };
    // @ts-expect-error a confirmed absence has no value, by design
    expect(absent.value).toBeUndefined();

    const stale: Reading<number> = {
      state: "stale",
      grade: "held-stale",
      value: 5,
      asOfUt: 10,
    };
    // A stale reading has no `reckon`: the capability IS the arm, so a widget
    // cannot call a model that does not exist.
    // @ts-expect-error `stale` offers no reckoning, by design
    expect(stale.reckon).toBeUndefined();
  });
});

describe("readingAge", () => {
  it("measures a stale reading against the frame's view time", () => {
    const stale: Reading<number> = {
      state: "stale",
      grade: "held-stale",
      value: 5,
      asOfUt: 10,
    };
    expect(readingAge(stale, 34)).toBe(24);
  });

  it("measures a reckonable reading by its OBSERVATION, not its model", () => {
    // Next to a propagated figure, the number an operator wants is how long ago
    // real contact was, which is what the model is being asked to bridge.
    const reading = readingFrom(
      point(10, 5),
      "held-stale",
      VIEW_UT,
      alwaysReckons,
    );
    expect(readingAge(reading, 34)).toBe(24);
  });

  it("measures a confirmed absence too, so a tombstone can itself go old", () => {
    expect(readingAge({ state: "absent", atUt: 10 }, 34)).toBe(24);
  });

  it("has no age for a pending reading", () => {
    expect(readingAge({ state: "pending" }, 34)).toBeUndefined();
  });

  it("has no age without a view time, rather than falling back to wall clock", () => {
    // `useViewUt` is `undefined` with no provider mounted. Reaching for
    // `Date.now()` here would let two reads in one frame disagree about how old
    // the same sample is, which is the bug `FrameToken` exists to stop.
    expect(
      readingAge({ state: "absent", atUt: 10 }, undefined),
    ).toBeUndefined();
  });

  it("clamps a view time behind the observation to zero rather than going negative", () => {
    // Out-of-order arrival is normal (`ClientTimeline` insert-sorts for it), so
    // a sample can sit marginally ahead of the frame's viewUt. "-0.4 s old" is
    // never a thing to render.
    expect(readingAge({ state: "absent", atUt: 10 }, 9.6)).toBe(0);
  });
});
