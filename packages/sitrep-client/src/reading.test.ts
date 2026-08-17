import { describe, expect, it } from "vitest";
import { type Reading, readingAge, readingFrom } from "./reading";
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

describe("readingFrom", () => {
  it("has no point yet, so the reading is pending", () => {
    expect(readingFrom(undefined, "resyncing")).toEqual({ state: "pending" });
  });

  it("stays pending when the status is resyncing even though a point exists", () => {
    // A rewind past a topic's first frame: there IS buffered data, just none
    // at-or-before this view time. Reporting the value would show the
    // operator a sample from the future of what they are looking at.
    expect(readingFrom(point(10, 5), "resyncing")).toEqual({
      state: "pending",
    });
  });

  it("carries the observation time on a confirmed absence", () => {
    // "Confirmed nothing, as of when": what lets a widget say "no target set
    // (confirmed 3 s ago)" rather than asserting it for the rest of the
    // mission.
    expect(readingFrom(point(10, null), "absent")).toEqual({
      state: "absent",
      atUt: 10,
    });
  });

  it("reports a live point as current, with its observation time", () => {
    expect(readingFrom(point(10, 5), "live")).toEqual({
      state: "current",
      value: 5,
      atUt: 10,
    });
  });

  it.each([
    "held-stale",
    "disconnected",
    "last-before-blackout",
  ] as const)("reports %s as stale, keeping the last real value reachable", (status) => {
    expect(readingFrom(point(10, 5), status)).toEqual({
      state: "stale",
      grade: status,
      lastObserved: { value: 5, atUt: 10 },
    });
  });

  it("supplies no reckoned value of its own", () => {
    // The reckoning is the provider's job and is pulled per frame, never
    // produced here: absence of the field is the statement that nothing
    // trustworthy can be said, so this must never fabricate one.
    const reading = readingFrom(point(10, 5), "held-stale");
    expect(reading.state).toBe("stale");
    if (reading.state !== "stale") return;
    expect(reading.reckoned).toBeUndefined();
  });

  it("degrades a stale-graded point with no payload to a confirmed absence", () => {
    // A tombstone that then went stale. The tombstone is the stronger claim
    // and there is no last-observed VALUE to carry, so `stale` cannot
    // represent it: `sampleRawStatus` already ranks `absent` above every
    // staleness grade for the same reason.
    expect(readingFrom(point(10, null), "held-stale")).toEqual({
      state: "absent",
      atUt: 10,
    });
  });
});

describe("Reading, as a type", () => {
  it("cannot be read for a value without branching", () => {
    // The whole point of the union. This test is really the two `@ts-expect-
    // error`s: they fail the build the day a plain `value` appears on the
    // non-current arms, which is the property the sweep depends on.
    const stale: Reading<number> = {
      state: "stale",
      grade: "held-stale",
      lastObserved: { value: 5, atUt: 10 },
    };
    // @ts-expect-error `stale` has no plain `value`, by design
    expect(stale.value).toBeUndefined();

    const pending: Reading<number> = { state: "pending" };
    // @ts-expect-error `pending` has no plain `value`, by design
    expect(pending.value).toBeUndefined();
  });
});

describe("readingAge", () => {
  it("measures a stale reading against the frame's view time", () => {
    const stale: Reading<number> = {
      state: "stale",
      grade: "held-stale",
      lastObserved: { value: 5, atUt: 10 },
    };
    expect(readingAge(stale, 34)).toBe(24);
  });

  it("measures a confirmed absence too, so a tombstone can itself go old", () => {
    expect(readingAge({ state: "absent", atUt: 10 }, 34)).toBe(24);
  });

  it("has no age for a pending reading", () => {
    expect(readingAge({ state: "pending" }, 34)).toBeUndefined();
  });

  it("has no age without a view time, rather than falling back to wall clock", () => {
    // `useViewUt` is `undefined` with no provider mounted. Reaching for
    // `Date.now()` here would let two reads in one frame disagree about how
    // old the same sample is, which is the bug `FrameToken` exists to stop.
    expect(
      readingAge({ state: "absent", atUt: 10 }, undefined),
    ).toBeUndefined();
  });

  it("clamps a view time behind the observation to zero rather than going negative", () => {
    // Out-of-order arrival is normal (`ClientTimeline` insert-sorts for it),
    // so a sample can sit marginally ahead of the frame's viewUt. "-0.4 s
    // old" is never a thing to render.
    expect(readingAge({ state: "absent", atUt: 10 }, 9.6)).toBe(0);
  });
});
