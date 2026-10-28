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
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { useDataSeries } from "./useDataSeries";

function Probe() {
  const range = useDataSeries("vessel.orbit.sma", 300);
  return <div data-testid="range">{range.v.join(",")}</div>;
}

function mount() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: createFakeWallClock().now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(100);
  render(
    <TelemetryProvider client={client} store={store}>
      <Probe />
    </TelemetryProvider>,
  );
  return { transport, store };
}

describe("useDataSeries across frames", () => {
  it("builds the window once while nothing it reads has moved, and again the frame a sample lands", () => {
    const { transport, store } = mount();
    act(() => {
      transport.emit("vessel.orbit", { sma: 679_400 }, { validAt: 10 });
      transport.emit("vessel.orbit", { sma: 679_800 }, { validAt: 50 });
      store.beginFrame();
    });
    expect(screen.getByTestId("range").textContent).toBe("679400,679800");

    const ranges = vi.spyOn(store, "sampleRange");
    act(() => {
      for (let frame = 0; frame < 30; frame++) store.beginFrame();
    });
    expect(ranges).not.toHaveBeenCalled();

    act(() => {
      transport.emit("vessel.orbit", { sma: 680_000 }, { validAt: 90 });
      store.beginFrame();
    });
    expect(ranges).toHaveBeenCalled();
    expect(screen.getByTestId("range").textContent).toBe(
      "679400,679800,680000",
    );
  });
});
