import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { useCertainty } from "./use-certainty";
import { ViewClock } from "./view-clock";

/** A wall clock a test can advance explicitly, instead of racing real time. */
function fakeWall(start = 0) {
  let now = start;
  return {
    now: () => now,
    advanceBy: (seconds: number) => {
      now += seconds;
    },
  };
}

function point(validAt: number, payload: number): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

function Certainty({ store }: { store: TimelineStore }) {
  const certainty = useCertainty(store, "vessel.target");
  return <div>certainty:{certainty}</div>;
}

describe("useCertainty", () => {
  it("re-renders on beginFrame() and surfaces the frame's certainty", () => {
    const wall = fakeWall();
    const clock = new ViewClock({
      nowWall: wall.now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    });
    const store = new TimelineStore(clock);

    render(<Certainty store={store} />);

    act(() => {
      store.ingest("vessel.target", point(10, 1));
      store.beginFrame();
    });
    // Confirmed mode (default): viewUt tracks confirmedEdgeUt(), which is
    // sample-clamped to the point just ingested — at-or-before the horizon.
    expect(screen.getByText("certainty:confirmed")).toBeTruthy();

    act(() => {
      clock.setMode("predicted");
      wall.advanceBy(50); // utNowEstimate races well past the sample-clamped horizon
      store.beginFrame();
    });
    expect(screen.getByText("certainty:predicted")).toBeTruthy();

    act(() => {
      clock.setMode("confirmed");
      store.beginFrame();
    });
    expect(screen.getByText("certainty:confirmed")).toBeTruthy();
  });
});
