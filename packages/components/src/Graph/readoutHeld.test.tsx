import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphComponent } from "./index";

/** The readout variant's headline states a newest figure, so it says so when that figure stops being current. */
describe("Graph readout headline when the topic stops arriving", () => {
  let restoreResizeObserver: () => void = () => {};
  beforeEach(() => {
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });
  afterEach(() => restoreResizeObserver());

  it("marks the figure as held once the link drops, with no wait for the window to pass", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const config = {
      variant: "readout" as const,
      series: [{ id: "sma", key: "vessel.orbit.sma", axis: "auto" as const }],
      windowSec: 300,
    };
    const { container } = render(
      <fixture.Provider>
        <GraphComponent config={config} id="graph-held" w={10} h={8} />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.orbit", { sma: 680_000 }, { validAt: 10 });
    });
    await waitFor(() => expect(container.textContent ?? "").toMatch(/680/));
    expect(container.querySelector("[data-held-mark]")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(container.querySelector("[data-held-mark]")).not.toBeNull(),
    );
  });
});
