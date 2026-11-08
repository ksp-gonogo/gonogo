import { afterEach, describe, expect, it } from "vitest";
import {
  getActiveTimelineEpoch,
  setActiveTimelineStoreForTests,
} from "./context";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function realStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
}

describe("getActiveTimelineEpoch", () => {
  afterEach(() => setActiveTimelineStoreForTests(undefined));

  it("answers nothing without a store", () => {
    expect(getActiveTimelineEpoch()).toBeUndefined();
  });

  it("answers the active store's epoch and names the store", () => {
    const store = realStore();
    setActiveTimelineStoreForTests(store);
    expect(getActiveTimelineEpoch()).toEqual({ epoch: 0, store });
  });

  it("names another store once a different one is active", () => {
    const first = realStore();
    const second = realStore();
    setActiveTimelineStoreForTests(first);
    setActiveTimelineStoreForTests(second);
    expect(getActiveTimelineEpoch()?.store).toBe(second);
  });

  it("answers nothing for a store that keeps no clock", () => {
    setActiveTimelineStoreForTests({
      sample: () => undefined,
      sampleReading: () => {
        throw new Error("unused");
      },
      currentFrame: () => ({}) as never,
      subscribeFrame: () => () => {},
    });
    expect(getActiveTimelineEpoch()).toBeUndefined();
  });
});
