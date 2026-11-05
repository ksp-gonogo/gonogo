import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphComponent } from "./index";

const CONFIG = {
  series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
  windowSec: 60,
};

describe("Graph awaiting data", () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = installFixedSizeResizeObserver({ width: 400, height: 300 });
  });
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it("waits before the first sample and never again once a series has drawn", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <GraphComponent config={CONFIG} id="graph-awaiting" w={10} h={8} />
      </fixture.Provider>,
    );
    expect(screen.getByText("Waiting for data...")).toBeTruthy();

    act(() => {
      fixture.emit("vessel.orbit", { sma: 679_400 }, { validAt: 5 });
      fixture.emit("vessel.orbit", { sma: 679_800 }, { validAt: 10 });
    });
    await waitFor(() =>
      expect(screen.queryByText("Waiting for data...")).toBeNull(),
    );

    // The clock runs on past the window, so no sample is left in it.
    act(() => fixture.scrubTo(10_000));
    await act(async () => {});
    expect(screen.queryByText("Waiting for data...")).toBeNull();
  });
});
