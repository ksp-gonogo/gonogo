import { delayLaneOf, isTrueNowTopic } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * What a channel's declared `DelayRole` buys the READER.
 *
 * The mod has classified channels since the delay architecture landed and the
 * client ignored the answer: every topic was read at the delayed view time, so
 * a frame the reveal gate had just let through instantly still sat unreadable
 * for exactly the light-time it had skipped. The two cancelled, which is why
 * nothing could see it. `warp-delay.characterise.test.ts` is where that was
 * measured; this is the mechanism that ends it.
 *
 * Read against the REAL generated table rather than a fixture topic invented
 * here. A test that declares its own roles proves the plumbing and says nothing
 * about whether the roles the mod actually declares reach it, which is the half
 * that was missing.
 */

/** One-way light time, seconds. A craft four minutes out. */
const OWLT = 240;
const UT_NOW = 10_000;

/** A ground-side fact, and a craft's state, as the mod declares them. */
const TRUE_NOW_TOPIC = "career.status";
const DELAYED_TOPIC = "vessel.flight";

function point(validAt: number, payload: unknown): TimelinePoint<unknown> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: UT_NOW }),
    epoch: 0,
  };
}

/**
 * A store at a real delay with both kinds of channel flowing, wired the way the
 * mod sends them: the delayed channel's newest frame is a light-time old on
 * arrival, the true-now channel's is current.
 */
function startStore() {
  let wall = 0;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => OWLT,
  });
  const store = new TimelineStore(clock);
  store.ingest(DELAYED_TOPIC, point(UT_NOW - OWLT, { altitudeAsl: 70_000 }));
  store.ingest(TRUE_NOW_TOPIC, point(UT_NOW, { funds: 42 }));
  store.beginFrame();
  return { clock, store, advance: (by: number) => (wall += by) };
}

describe("a channel's declared delay role", () => {
  it("is the one the mod declares, not one this file invented", () => {
    expect(isTrueNowTopic(TRUE_NOW_TOPIC)).toBe(true);
    expect(delayLaneOf(TRUE_NOW_TOPIC)).toBe("true-now");
    expect(delayLaneOf(DELAYED_TOPIC)).toBe("delayed");
    /* `time.warp` is the channel the 2026-09-11 ruling reclassified, and the
       one the scan behind this table could not see until it learned to read an
       amended declaration. */
    expect(isTrueNowTopic("time.warp")).toBe(true);
  });

  it("puts the two view times a whole light-time apart", () => {
    const { store } = startStore();
    const frame = store.currentFrame();
    expect(frame.viewUt).toBe(UT_NOW - OWLT);
    expect(frame.trueNowViewUt).toBe(UT_NOW);
  });

  it("reads a TrueNow channel at its own validAt, not a light-time later", () => {
    const { store } = startStore();
    expect(store.sample(TRUE_NOW_TOPIC)?.validAt).toBe(UT_NOW);
  });

  it("still holds a Delayed channel back to the delayed view time", () => {
    const { store } = startStore();
    // The frame carrying a craft's state at the TRUE now, which an operator a
    // light-minute away has no business seeing yet.
    store.ingest(DELAYED_TOPIC, point(UT_NOW, { altitudeAsl: 80_000 }));
    store.beginFrame();
    expect(store.sample(DELAYED_TOPIC)?.validAt).toBe(UT_NOW - OWLT);
  });

  it("reads a TrueNow channel's field subtopic at the same instant as its record", () => {
    const { store } = startStore();
    const record = store.sample(TRUE_NOW_TOPIC);
    const field = store.sample(`${TRUE_NOW_TOPIC}.funds`);
    expect(field?.payload).toBe(42);
    expect(field?.validAt).toBe(record?.validAt);
  });

  it("classifies a TrueNow read confirmed rather than predicted", () => {
    const { store } = startStore();
    const frame = store.currentFrame();
    expect(frame.trueNowCertainty).toBe("confirmed");
  });

  it("keeps a derived channel mixing roles on the delayed lane", () => {
    const { store } = startStore();
    /* `system.bodies` is TrueNow and `vessel.flight` is not, which is the shape
       `vessel.state` really has. The output must not be stamped more current
       than the most delayed thing it read. */
    store.ingest("system.bodies", point(UT_NOW, { bodies: [] }));
    store.registerDerivedChannel({
      topic: "mixed.state",
      inputs: ["system.bodies", DELAYED_TOPIC],
      derive: (get) => {
        const flight = get(DELAYED_TOPIC);
        return flight ? { at: flight.validAt } : undefined;
      },
    });
    store.beginFrame();
    expect(store.sample("mixed.state")?.validAt).toBe(UT_NOW - OWLT);
  });

  it("lets an all-TrueNow derived channel run at true now", () => {
    const { store } = startStore();
    store.ingest("system.bodies", point(UT_NOW, { bodies: [] }));
    store.registerDerivedChannel({
      topic: "ground.state",
      inputs: ["system.bodies", TRUE_NOW_TOPIC],
      derive: (get) => {
        const career = get(TRUE_NOW_TOPIC);
        return career ? { at: career.validAt } : undefined;
      },
    });
    store.beginFrame();
    expect(store.sample("ground.state")?.validAt).toBe(UT_NOW);
  });

  it("holds the true-now lane at the delayed edge while nothing newer has arrived", () => {
    /* The clamp that makes this safe: the lane is `min(estimate, max observed
       sample UT)`, so with only delayed traffic on the wire it cannot run ahead
       of what has actually been delivered. */
    const wall = 0;
    const clock = new ViewClock({
      nowWall: () => wall,
      warpRate: () => 1,
      delaySeconds: () => OWLT,
    });
    const store = new TimelineStore(clock);
    store.ingest(DELAYED_TOPIC, point(UT_NOW - OWLT, { altitudeAsl: 70_000 }));
    store.beginFrame();
    expect(store.currentFrame().trueNowViewUt).toBe(UT_NOW - OWLT);
  });
});
