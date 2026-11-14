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
  const sma = useDataSeries("vessel.orbit.sma", 300);
  const alt = useDataSeries("vessel.flight.altitude", 300);
  return (
    <div>
      <div data-testid="sma">
        t:{sma.t.join(",")}|end:{String(sma.windowEndAt)}
      </div>
      <div data-testid="alt">
        t:{alt.t.join(",")}|end:{String(alt.windowEndAt)}
      </div>
    </div>
  );
}

function mount() {
  const wall = createFakeWallClock(1000);
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  render(
    <TelemetryProvider client={client} store={store}>
      <Probe />
    </TelemetryProvider>,
  );
  return { transport, store, wall, clock };
}

describe("useDataSeries after a rewind", () => {
  it("draws nothing later than the present once a load has set the clock back", async () => {
    const { transport, store, wall, clock } = mount();
    const tick = (ut: number, epoch: number, only?: string) => {
      if (only !== "alt") {
        transport.emit(
          "vessel.orbit",
          { sma: ut },
          { validAt: ut, deliveredAt: ut, timelineEpoch: epoch },
        );
      }
      transport.emit(
        "vessel.flight",
        { altitude: ut },
        { validAt: ut, deliveredAt: ut, timelineEpoch: epoch },
      );
      clock.emitFrame();
      store.beginFrame();
    };
    act(() => {
      for (const ut of [1000, 1010, 1020, 1030]) {
        tick(ut, 0);
        wall.advanceBy(10);
      }
    });
    await waitFor(() =>
      expect(screen.getByTestId("sma").textContent).toContain("1030"),
    );
    act(() => {
      tick(500, 1);
      wall.advanceBy(1);
      tick(501, 1);
    });
    const text = (id: string) => screen.getByTestId(id).textContent ?? "";
    const latest = (id: string) => {
      const m = /t:([^|]*)\|/.exec(text(id))?.[1] ?? "";
      return m === "" ? [] : m.split(",").map(Number);
    };
    await waitFor(() => expect(latest("sma")).toContain(500));
    expect(Math.max(...latest("sma"))).toBeLessThanOrEqual(501);
    expect(Math.max(...latest("alt"))).toBeLessThanOrEqual(501);
    expect(text("sma")).not.toContain("end:10");
    expect(store.currentFrame().viewUt).toBeLessThan(600);
  });
});
