import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  hasAnswered,
  observedAt,
  type Reading,
  type ReckonerFor,
  readingFrom,
  type UnmodelledReading,
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
 * A model that always has an answer, so `reckoning: "available"` is reachable.
 * It covers the payload ROOT, which is what a whole-topic read needs: a model
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
      reckoning: "none",
    });
  });

  it("stays pending when the status is resyncing even though a point exists", () => {
    // A rewind past a topic's first frame: there IS buffered data, just none
    // at-or-before this view time. Reporting the value would show the operator
    // a sample from the future of what they are looking at.
    expect(readingFrom(point(10, 5), "resyncing", VIEW_UT)).toEqual({
      state: "pending",
      reckoning: "none",
    });
  });

  it("carries the observation time on a confirmed absence", () => {
    // "Confirmed nothing, as of when": what lets a widget say "no target set
    // (confirmed 3 s ago)" rather than asserting it for the rest of the mission.
    expect(readingFrom(point(10, null), "absent", VIEW_UT)).toEqual({
      state: "absent",
      reckoning: "none",
      atUt: value("ut", 10),
    });
  });

  it("reports a live point as observed, with its observation time", () => {
    expect(readingFrom(point(10, 5), "live", VIEW_UT)).toEqual({
      state: "observed",
      reckoning: "none",
      value: 5,
      atUt: value("ut", 10),
    });
  });

  it.each([
    "held-stale",
    "disconnected",
    "last-before-blackout",
  ] as const)("reports %s as stale with no reckoner, keeping the last real value", (status) => {
    expect(readingFrom(point(10, 5), status, VIEW_UT)).toEqual({
      state: "stale",
      reckoning: "none",
      grade: status,
      value: 5,
      asOfUt: value("ut", 10),
    });
  });

  it("offers no reckoning when the reckoner declines", () => {
    // The honest majority: most data can only be AGED. A declining reckoner and
    // no reckoner at all must be indistinguishable to a widget, so that
    // "nothing trustworthy can be said" has exactly one rendering.
    const declines: ReckonerFor<number> = () => undefined;
    expect(readingFrom(point(10, 5), "held-stale", VIEW_UT, declines)).toEqual({
      state: "stale",
      reckoning: "none",
      grade: "held-stale",
      value: 5,
      asOfUt: value("ut", 10),
    });
  });

  it("offers a reckoning when a model exists, and still carries the real observation", () => {
    const reading = readingFrom(
      point(10, 5),
      "last-before-blackout",
      VIEW_UT,
      alwaysReckons,
    );
    // The two axes say separate things about the same reading: we have missed
    // updates AND a model is on offer. Neither implies the other.
    expect(reading.state).toBe("stale");
    expect(reading.reckoning).toBe("available");
    if (reading.state !== "stale") return;
    // The last REAL value, not the modelled one. A widget that wants "10% at
    // last contact" reads this; a widget that wants the propagated figure reads
    // `reckoned`. Neither is a substitute for the other.
    expect(reading.value).toBe(5);
    expect(reading.asOfUt).toEqual(value("ut", 10));
    expect(reading.grade).toBe("last-before-blackout");
  });

  /**
   * The capability the split exists for, and the case that was unrepresentable
   * while reckonability rode the staleness discriminant: a value that arrived on
   * time, with a model that can carry it forward to the frame's view time.
   * Saying so used to mean also claiming we had missed updates.
   */
  it("offers a reckoning on a LIVE reading, which stays observed", () => {
    const reading = readingFrom(point(10, 5), "live", VIEW_UT, alwaysReckons);
    expect(reading).toEqual({
      state: "observed",
      reckoning: "available",
      value: 5,
      atUt: value("ut", 10),
      reckoned: {
        value: 6,
        atUt: value("ut", VIEW_UT),
        basis: "linear-dead-reckoning",
        modelled: [{ path: "", basis: "linear-dead-reckoning" }],
      },
    });
  });

  it("tells a live reckoner it is live, by passing no grade", () => {
    /*
     * A reckoner that integrates FROM the loss of contact needs to know contact
     * was never lost, and declining is how it says so. `undefined` is that
     * signal, and it is the only one available.
     */
    const grades: (string | undefined)[] = [];
    const recording: ReckonerFor<number> = (p, grade) => {
      grades.push(grade);
      return {
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => p.payload ?? 0,
      };
    };
    readingFrom(point(10, 5), "live", VIEW_UT, recording);
    readingFrom(point(10, 5), "held-stale", VIEW_UT, recording);
    expect(grades).toEqual([undefined, "held-stale"]);
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
    if (reading.reckoning !== "available")
      throw new Error("expected a reckoning on offer");
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
    if (reading.reckoning !== "available")
      throw new Error("expected a reckoning on offer");
    if (reading.state !== "stale") throw new Error("expected stale");
    const reckoned = reading.reckoned;
    expect(reckoned).toEqual({
      value: 6,
      atUt: value("ut", VIEW_UT),
      basis: "linear-dead-reckoning",
      modelled: [{ path: "", basis: "linear-dead-reckoning" }],
    });
    // The two UTs are different questions: when we last saw it, and what moment
    // the model is claiming about.
    // Ordering two instants, which the affine rules still allow: point against
    // point is the one comparison that means something here.
    expect(reckoned.atUt.greaterThan(reading.asOfUt)).toBe(true);
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
      reckoning: "none",
      atUt: value("ut", 10),
    });
  });
});

describe("withoutReckoning", () => {
  it("drops the model from a stale reading and leaves the grade alone", () => {
    const reading = readingFrom(
      point(10, 5),
      "held-stale",
      VIEW_UT,
      alwaysReckons,
    );
    expect(withoutReckoning(reading)).toEqual({
      state: "stale",
      reckoning: "none",
      grade: "held-stale",
      value: 5,
      asOfUt: value("ut", 10),
    });
  });

  /**
   * Only `reckoning` moves. Declining a model is not an admission that updates
   * were missed, and while reckonability rode the staleness discriminant this
   * call could not say so: it collapsed the reading to `stale` and told the
   * operator contact had been lost when it had not.
   */
  it("leaves a LIVE reading observed when it declines the model", () => {
    const reading = readingFrom(point(10, 5), "live", VIEW_UT, alwaysReckons);
    expect(withoutReckoning(reading)).toEqual({
      state: "observed",
      reckoning: "none",
      value: 5,
      atUt: value("ut", 10),
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
    const pending: Reading<number> = { state: "pending", reckoning: "none" };
    // @ts-expect-error `pending` has no value at all, by design
    expect(pending.value).toBeUndefined();

    const absent: Reading<number> = {
      state: "absent",
      reckoning: "none",
      atUt: value("ut", 10),
    };
    // @ts-expect-error a confirmed absence has no value, by design
    expect(absent.value).toBeUndefined();
  });

  /**
   * The second discriminant carries the same compiler pressure the `reckonable`
   * arm used to: `reckoned` is a required field of a member selected by a
   * required discriminant, so reaching it costs a written test exactly as
   * reaching a value does. An optional field would have compiled here.
   */
  it("cannot be read for a reckoning without writing the discriminant", () => {
    const reading: Reading<number> = {
      state: "stale",
      reckoning: "none",
      grade: "held-stale",
      value: 5,
      asOfUt: value("ut", 10),
    };
    // @ts-expect-error the reckoning axis has not been narrowed yet, by design
    expect(reading.reckoned).toBeUndefined();

    const unmodelled: UnmodelledReading<number> = reading;
    // @ts-expect-error a reading with no model on offer has no `reckoned` at all
    expect(unmodelled.reckoned).toBeUndefined();
  });
});

describe("observedAt", () => {
  /**
   * `readingAge` used to live here and did the subtraction itself, returning a bare
   * `number`. An age is now `viewUt.minus(observedAt(reading))`, which is a
   * `Value<"s">` natively because the affine rules made a difference of two instants
   * say what it is. So the library answers WHEN, and the caller does the arithmetic.
   *
   * Two things moved to the caller with it, and both are asserted below rather than
   * assumed: the undefined-view-time case, and the clamp.
   */
  it("answers with the OBSERVATION's instant for a stale reading", () => {
    const stale: Reading<number> = {
      state: "stale",
      reckoning: "none",
      grade: "held-stale",
      value: 5,
      asOfUt: value("ut", 10),
    };
    expect(observedAt(stale)).toEqual(value("ut", 10));
    expect(value("ut", 34).minus(observedAt(stale) as Value<"ut">)).toEqual(
      value("s", 24),
    );
  });

  it("answers by the OBSERVATION for a reading with a model, not by its model", () => {
    const reading: Reading<number> = {
      state: "stale",
      reckoning: "available",
      grade: "held-stale",
      value: 5,
      asOfUt: value("ut", 10),
      reckoned: {
        value: 9,
        atUt: value("ut", 34),
        basis: "kepler-propagation",
        modelled: [{ path: "", basis: "kepler-propagation" }],
      },
    };
    // The model's instant is the frame; the observation's is what went old.
    expect(observedAt(reading)).toEqual(value("ut", 10));
  });

  it("answers for a confirmed absence too, so a tombstone can itself go old", () => {
    expect(
      observedAt({ state: "absent", reckoning: "none", atUt: value("ut", 10) }),
    ).toEqual(value("ut", 10));
  });

  it("has no instant for a pending reading: there is no observation to be old", () => {
    expect(observedAt({ state: "pending", reckoning: "none" })).toBeUndefined();
  });

  it("subtracts to a NEGATIVE duration when a sample sits ahead of the frame", () => {
    // The clamp moved out of the library and into every caller, so this records
    // what the raw subtraction does rather than pretending it cannot happen.
    // Out-of-order arrival is normal (`ClientTimeline` insert-sorts for it), so a
    // sample can sit marginally ahead of the frame's view time, and every caller
    // clamps at zero because "-0.4 s old" is never a thing to render.
    const absent: Reading<number> = {
      state: "absent",
      reckoning: "none",
      atUt: value("ut", 10),
    };
    const raw = value("ut", 9.6).minus(observedAt(absent) as Value<"ut">);
    expect(raw.magnitude).toBeCloseTo(-0.4);
    expect(Math.max(0, raw.magnitude)).toBe(0);
  });
});

describe("the unowned arm", () => {
  it("is what an empty read becomes once the mod's verdict is in", () => {
    expect(readingFrom(undefined, "resyncing", 0, undefined, true)).toEqual({
      state: "unowned",
      reckoning: "none",
    });
  });

  it("is pending without the verdict, which is the default", () => {
    expect(readingFrom(undefined, "resyncing", 0)).toEqual({
      state: "pending",
      reckoning: "none",
    });
  });

  /**
   * The verdict only ever redirects the EMPTY case. A topic that has published
   * was necessarily acked, so it can never be carrying one, and the arm order
   * must not let a stale verdict outrank a real observation.
   */
  it("never displaces an observation", () => {
    expect(readingFrom(point(10, 5), "live", 10, undefined, true)).toEqual({
      state: "observed",
      reckoning: "none",
      value: 5,
      atUt: value("ut", 10),
    });
  });

  it("has no observation instant, exactly as pending has none", () => {
    expect(observedAt({ state: "unowned", reckoning: "none" })).toBeUndefined();
  });

  it("passes through withoutReckoning untouched", () => {
    const reading: Reading<number> = { state: "unowned", reckoning: "none" };
    expect(withoutReckoning(reading)).toBe(reading);
  });
});

describe("hasAnswered", () => {
  const atUt: Value<"ut"> = value("ut", 10);

  it("is false for both empty arms, and unowned is the one that matters", () => {
    // A hand-rolled `state !== "pending"` reads unowned as the producer having
    // answered, which opens a presence gate on a build where the Uplink is not
    // installed. That is the regression this function exists to prevent.
    expect(hasAnswered({ state: "pending" })).toBe(false);
    expect(hasAnswered({ state: "unowned" })).toBe(false);
  });

  it("reads the staleness axis only, whatever the reckoning axis says", () => {
    /*
     * It takes the discriminant alone and must keep doing so: a presence gate
     * asking "has the producer spoken" is not asking whether a model is on
     * offer, and the two axes are independent.
     */
    expect(hasAnswered({ state: "observed" })).toBe(true);
  });

  // `hasAnswered` takes the discriminant alone, so a whole arm written inline
  // is a fresh literal with excess properties and does not compile. Naming each
  // arm as a `Reading<number>` first keeps the arms visible, which is the point
  // of the assertions, and puts them under the union's own check: an arm that
  // stopped matching `Reading` would now fail here rather than pass as an
  // anonymous bag.
  const absent: Reading<number> = { state: "absent", reckoning: "none", atUt };
  const observed: Reading<number> = {
    state: "observed",
    reckoning: "none",
    value: 1,
    atUt,
  };
  const stale: Reading<number> = {
    state: "stale",
    reckoning: "none",
    value: 1,
    asOfUt: atUt,
    grade: "held-stale",
  };
  const staleWithModel: Reading<number> = {
    state: "stale",
    reckoning: "available",
    value: 1,
    asOfUt: atUt,
    grade: "last-before-blackout",
    reckoned: {
      value: 2,
      atUt,
      basis: "linear-dead-reckoning",
      modelled: [{ path: "", basis: "linear-dead-reckoning" }],
    },
  };

  it("is true for a tombstone, because a producer saying no is a producer", () => {
    expect(hasAnswered(absent)).toBe(true);
  });

  it("is true for every arm that carries an observation", () => {
    expect(hasAnswered(observed)).toBe(true);
    expect(hasAnswered(stale)).toBe(true);
    expect(hasAnswered(staleWithModel)).toBe(true);
  });
});
