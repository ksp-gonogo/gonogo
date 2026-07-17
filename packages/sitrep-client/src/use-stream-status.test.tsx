import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { useStreamStatus } from "./use-stream-status";
import { ViewClock } from "./view-clock";

function point(validAt: number, payload: number): TimelinePoint<number> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

function Status({ store }: { store: TimelineStore }) {
  const status = useStreamStatus(store, "vessel.target");
  return <div>status:{status}</div>;
}

describe("useStreamStatus", () => {
  it("reads at the frozen viewUt and re-renders only when the frame advances", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);

    render(<Status store={store} />);
    expect(screen.getByText("status:resyncing")).toBeTruthy(); // nothing buffered yet

    act(() => {
      store.ingest("vessel.target", point(10, 1));
      store.beginFrame();
    });
    expect(screen.getByText("status:live")).toBeTruthy();
  });
});
