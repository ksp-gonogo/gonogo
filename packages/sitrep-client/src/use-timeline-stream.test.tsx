import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { useTimelineStream } from "./use-timeline-stream";
import { ViewClock } from "./view-clock";

function point(validAt: number, payload: number): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

function Alt({ store }: { store: TimelineStore }) {
  const v = useTimelineStream<number>(store, "vessel.state.altitudeAsl");
  return <div>alt:{v ?? "—"}</div>;
}

describe("useTimelineStream", () => {
  it("reads at the frozen viewUt and re-renders only when the frame advances", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    render(<Alt store={store} />);
    expect(screen.getByText("alt:—")).toBeTruthy(); // nothing buffered yet

    act(() => {
      store.ingest("vessel.state.altitudeAsl", point(10, 500));
      store.beginFrame();
    });
    expect(screen.getByText("alt:500")).toBeTruthy();

    // A new sample arrives but the frame hasn't advanced yet — no re-render
    // to a value the frozen frame token wouldn't itself see.
    act(() => {
      store.ingest("vessel.state.altitudeAsl", point(20, 600));
    });
    expect(screen.getByText("alt:500")).toBeTruthy();

    act(() => {
      store.beginFrame();
    });
    expect(screen.getByText("alt:600")).toBeTruthy();
  });
});
