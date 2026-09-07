import { describe, expect, it } from "vitest";
import type { CommsDelay } from "./__generated__/contract";
import { CommsDelaySource } from "./__generated__/contract";
import type { ReckonerAnswer, StaleGrade } from "./reading";
import { registerCoreReckoners } from "./spine/core-reckoners";
import { getReckoner } from "./spine/reckoners";
import { makeMeta } from "./testing/stub-transport";
import type { TimelinePoint } from "./timeline";
import { value } from "./unit-system/value";

/**
 * The forward model for `comms.delay`, which is the reason the producer
 * publishes a rate at all: a reckoner is handed one point and no history, so
 * without `oneWaySecondsRate` on the payload there is nothing here to carry the
 * light-time with, and the topic reads as unmodelled forever.
 *
 * Everything below goes through the REGISTRY rather than importing the
 * definition, because registration is what a consumer actually meets and a model
 * nobody registered is not a model.
 */

registerCoreReckoners();

/**
 * One `comms.delay` payload. `source` and `meta` are required on the type and
 * uninteresting to every case here; the two nullable numbers are the whole
 * subject, and each is left absent by default so a test can say so.
 */
function delay(fields: Partial<CommsDelay> = {}): CommsDelay {
  return {
    source: CommsDelaySource.SignalDelay,
    meta: makeMeta({ source: "vessel:x" }),
    ...fields,
  };
}

function delayPoint(
  validAt: number,
  payload: CommsDelay,
): TimelinePoint<CommsDelay> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt, source: "vessel:x" }),
    epoch: 0,
  };
}

/**
 * The grade a reading takes once the stream stops arriving, and the one this
 * model exists for. Two things now leave a gap to carry across: the whole
 * stream going quiet, and a comms blackout, which freezes `comms.delay` at its
 * last connected frame like any other Delayed channel. The second is new: while
 * the channel was true-now it kept arriving through an outage reporting no
 * measurable delay, and a frame with no delay carries no rate, so there was
 * nothing to integrate.
 */
const STALE: StaleGrade = "held-stale";

/**
 * `grade` is passed positionally and NEVER defaulted, because `undefined` is the
 * value under test: it is what the store passes on a LIVE reading, and a default
 * parameter would silently turn the one case that matters into a stale one.
 */
function reckon(
  payload: CommsDelay,
  viewUt: number,
  grade: StaleGrade | undefined,
): ReckonerAnswer<unknown, unknown> {
  const elected = getReckoner("comms.delay");
  if (!elected) throw new Error("comms.delay has no registered reckoner");
  return elected.definition.reckon(delayPoint(100, payload), [], {
    grade,
    viewUt,
  });
}

/**
 * The wrapped seconds a modelled payload carries on `oneWaySeconds`, or null for
 * anything else.
 *
 * Walked field by field rather than asserted through, because the registry hands
 * back the ERASED definition and a modelled payload is genuinely `unknown` at
 * that boundary. Every step of the walk is a check a cast would have skipped, and
 * skipping them is how a test comes to assert against a shape the model does not
 * actually produce.
 */
function modelledSeconds(moved: unknown): number | null {
  if (!moved || typeof moved !== "object" || !("oneWaySeconds" in moved)) {
    return null;
  }
  const field: unknown = moved.oneWaySeconds;
  if (!field || typeof field !== "object" || !("magnitude" in field)) {
    return null;
  }
  const magnitude: unknown = field.magnitude;
  return typeof magnitude === "number" && Number.isFinite(magnitude)
    ? magnitude
    : null;
}

/** The carried light-time, in seconds, off an answer that offered a model. */
function carried(answer: ReckonerAnswer<unknown, unknown>, at: number): number {
  if ("declined" in answer) {
    throw new Error(`declined: ${JSON.stringify(answer.declined)}`);
  }
  const seconds = modelledSeconds(answer.reckon(at));
  if (seconds === null) throw new Error("no light-time was carried");
  return seconds;
}

const RECEDING = delay({
  oneWaySeconds: value("s", 2000),
  oneWaySecondsRate: value("1", 0.01),
});

describe("comms.delay carries its light-time at the published rate", () => {
  it("integrates the rate across the gap", () => {
    const answer = reckon(RECEDING, 140, STALE);

    // Forty seconds of view time at 0.01 s/s is 0.4 s further away.
    expect(carried(answer, 140)).toBeCloseTo(2000.4, 9);
  });

  it("carries a closing craft the other way", () => {
    const answer = reckon(
      delay({
        oneWaySeconds: value("s", 2000),
        oneWaySecondsRate: value("1", -0.01),
      }),
      140,
      STALE,
    );

    expect(carried(answer, 140)).toBeCloseTo(1999.6, 9);
  });

  it("names the contract's own spelling when no rate was published", () => {
    /*
     * Every case the producer refuses a rate for: a reroute, the first
     * observation of a route, the delay feature being switched on, a blackout.
     * The operator gets the field name rather than a sentence about this model.
     */
    const answer = reckon(
      delay({ oneWaySeconds: value("s", 2000) }),
      140,
      STALE,
    );

    expect(answer).toEqual({
      declined: { reason: "input-absent", input: "oneWaySecondsRate" },
    });
  });

  it("declines when there is no measured light-time to carry", () => {
    const answer = reckon(
      delay({ oneWaySecondsRate: value("1", 0.01) }),
      140,
      STALE,
    );

    expect("declined" in answer && answer.declined.reason).toBe(
      "model-inapplicable",
    );
  });

  it("declines on a live reading, having nothing to add to a current value", () => {
    const answer = reckon(RECEDING, 140, undefined);

    expect("declined" in answer && answer.declined.reason).toBe(
      "model-inapplicable",
    );
  });

  it("declines past a horizon set by the light-time rather than by a clock", () => {
    /*
     * 0.01 s/s reaches a quarter of 2000 s after 50000 s of view time, which is
     * moments of real time under warp and never reached at 1x. The same rate
     * against a low-orbit light-time would be past its horizon almost at once,
     * which is the point of stating the horizon relatively.
     */
    expect("declined" in reckon(RECEDING, 100 + 49_000, STALE)).toBe(false);
    const far = reckon(RECEDING, 100 + 51_000, STALE);
    expect("declined" in far && far.declined.reason).toBe("beyond-horizon");
  });

  it("carries a measured zero rate without declining", () => {
    /*
     * A craft holding its distance, and the case a null rate must never be
     * collapsed onto: there IS a model here and it says the delay is unchanged.
     */
    const answer = reckon(
      delay({
        oneWaySeconds: value("s", 2000),
        oneWaySecondsRate: value("1", 0),
      }),
      100_000,
      STALE,
    );

    expect(carried(answer, 100_000)).toBe(2000);
  });
});
