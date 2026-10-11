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
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useDataSeries } from "./useDataSeries";

/**
 * A series says how to draw between its points from the plotted value's own
 * sample kind, so a chart never invents what lies between two samples.
 */

function Probe({ dataKey }: { dataKey: string }) {
  const range = useDataSeries(dataKey, 300);
  return (
    <div data-testid="range">
      t:{range.t.join(",")}|draw:{range.interpolation ?? "linear"}
    </div>
  );
}

function fixture() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(100);
  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }
  return { transport, Provider };
}

const read = () => screen.getByTestId("range").textContent ?? "";

describe("useDataSeries draws between points by the value's kind", () => {
  it("joins a continuous field with a line", async () => {
    const f = fixture();
    render(
      <f.Provider>
        <Probe dataKey="vessel.propulsion.totalMass" />
      </f.Provider>,
    );
    act(() => {
      f.transport.emit(
        "vessel.propulsion",
        { totalMass: 30, dryMass: 10 },
        { validAt: 10 },
      );
      f.transport.emit(
        "vessel.propulsion",
        { totalMass: 20, dryMass: 10 },
        { validAt: 50 },
      );
    });
    await waitFor(() => expect(read()).toBe("t:10,50|draw:linear"));
  });

  it("steps a discrete field in the same Topic", async () => {
    const f = fixture();
    render(
      <f.Provider>
        <Probe dataKey="vessel.propulsion.dryMass" />
      </f.Provider>,
    );
    act(() => {
      f.transport.emit(
        "vessel.propulsion",
        { totalMass: 30, dryMass: 10 },
        { validAt: 10 },
      );
      f.transport.emit(
        "vessel.propulsion",
        { totalMass: 20, dryMass: 8 },
        { validAt: 50 },
      );
    });
    await waitFor(() => expect(read()).toBe("t:10,50|draw:step"));
  });

  it("draws an event channel as points, once per occurrence even when a keyframe repeats it", async () => {
    const f = fixture();
    render(
      <f.Provider>
        <Probe dataKey="crash.lastCrash" />
      </f.Provider>,
    );
    const crash = { ut: 10, vesselName: "Kerbal X" };
    act(() => {
      f.transport.emit("crash.lastCrash", crash, { validAt: 10 });
      // The keyframe re-sends the same record at its own instant.
      f.transport.emit("crash.lastCrash", crash, { validAt: 70 });
      f.transport.emit(
        "crash.lastCrash",
        { ut: 80, vesselName: "Kerbal X" },
        { validAt: 80 },
      );
    });
    await waitFor(() => expect(read()).toBe("t:10,80|draw:none"));
  });
});
