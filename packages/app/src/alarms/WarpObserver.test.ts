import { describe, expect, it } from "vitest";
import { WarpObserver } from "./WarpObserver";

describe("WarpObserver.rateBefore", () => {
  it("is null, not 1x, when no warp reading has arrived", () => {
    const observer = new WarpObserver(
      {
        getAlarms: () => [],
        getObservedUT: () => 1_000,
        isWarpToActive: () => false,
      },
      () => 0,
    );
    observer.observeWarp();

    expect(observer.getWarp().rate).toBe(1);
    expect(observer.rateBefore(2_000)).toBeNull();
  });
});
