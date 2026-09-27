import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { useCertainty } from "./use-certainty";
import { ViewClock } from "./view-clock";

const LIGHT_TIME_SECONDS = 10;

function point(validAt: number, payload: number): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt + LIGHT_TIME_SECONDS }),
    epoch: 0,
  };
}

function Certainty({ store }: { store: TimelineStore }) {
  const certainty = useCertainty(store, "vessel.target");
  return <div>certainty:{certainty}</div>;
}

describe("useCertainty", () => {
  it("re-renders on beginFrame() and surfaces the frame's certainty", () => {
    const clock = new ViewClock({
      warpRate: () => 1,
      delaySeconds: () => LIGHT_TIME_SECONDS,
    });
    const store = new TimelineStore(clock);

    render(<Certainty store={store} />);

    act(() => {
      store.ingest("vessel.target", point(10, 1));
      store.beginFrame();
    });
    // Live, viewUt tracks confirmedEdgeUt(), which is sample-clamped to the point just ingested: at-or-before the horizon.
    expect(screen.getByText("certainty:confirmed")).toBeTruthy();

    act(() => {
      clock.scrubTo(10 + LIGHT_TIME_SECONDS); // the craft's present on delivery, a light-time past the horizon
      store.beginFrame();
    });
    expect(screen.getByText("certainty:predicted")).toBeTruthy();

    act(() => {
      clock.scrubTo(null);
      store.beginFrame();
    });
    expect(screen.getByText("certainty:confirmed")).toBeTruthy();
  });
});
