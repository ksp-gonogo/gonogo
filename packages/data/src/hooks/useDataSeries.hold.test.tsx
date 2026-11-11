import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useDataSeries } from "./useDataSeries";

function Probe() {
  const range = useDataSeries("vessel.orbit.sma", 300);
  // A second subscribed channel, so the link can be confirmed past the first one's last sample.
  useDataSeries("vessel.flight.altitude", 300);
  return (
    <div data-testid="range">
      t:{range.t.join(",")}|end:{String(range.windowEndAt)}
    </div>
  );
}

function mount(pinnedUt?: number) {
  const wall = createFakeWallClock(1000);
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  if (pinnedUt !== undefined) clock.scrubTo(pinnedUt);
  render(
    <TelemetryProvider client={client} store={store}>
      <Probe />
    </TelemetryProvider>,
  );
  return { transport, store, wall, clock };
}

describe("useDataSeries: a series that stopped emitting", () => {
  it("closes its window on the view time, so the last value is held to it", async () => {
    const { transport, store, wall, clock } = mount();
    act(() => {
      transport.emit(
        "vessel.orbit",
        { sma: 1 },
        { validAt: 1000, deliveredAt: 1000 },
      );
      clock.emitFrame();
      store.beginFrame();
    });
    await waitFor(() =>
      expect(screen.getByTestId("range").textContent).toContain("t:1000"),
    );
    act(() => {
      wall.advanceBy(30);
      // Another channel keeps the link confirmed, which is what advances the view time.
      transport.emit("vessel.flight", {}, { validAt: 1030, deliveredAt: 1030 });
      clock.emitFrame();
      store.beginFrame();
    });
    const frame = store.currentFrame();
    expect(store.sampleStatus("vessel.orbit.sma", frame)).toBe("live");
    await waitFor(() =>
      expect(screen.getByTestId("range").textContent).toBe(
        `t:1000|end:${Math.floor(frame.viewUt)}`,
      ),
    );
    expect(frame.viewUt).toBeGreaterThan(1000);
  });
});
