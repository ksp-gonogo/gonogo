import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/** Apsis markers are not drawn in a frame where apsides do not exist. */

function setup() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-frame" }}>
        <OrbitViewComponent id="ov-frame" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 850000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
      mu: 3.5316e12,
    });
    fixture.emit("system.bodies", {
      bodies: [
        { index: 1, name: "Kerbin", gravParameter: 3.5316e12, radius: 600000 },
      ],
    });
  });
  return fixture;
}

describe("OrbitView: the apsis markers and the view frame", () => {
  it("draws the Ap and Pe labels in a frame that has apsides", async () => {
    // The contrast case: without it, the absence below could pass on a widget that never drew the labels.
    const fixture = setup();
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() => expect(screen.getByText("Ap")).toBeTruthy());
    expect(screen.getByText("Pe")).toBeTruthy();
  });

  it("draws neither in a frame defined by a pair of bodies", async () => {
    // A dot labelled Ap on a point that does not exist, beside a panel saying it does not exist.
    const fixture = setup();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      });
    });

    // Wait for the diagram first: `waitFor` around a negative assertion passes on its first tick.
    await waitFor(() => expect(screen.getByText(/orbit plane/)).toBeTruthy());
    expect(screen.queryByText("Ap")).not.toBeInTheDocument();
    expect(screen.queryByText("Pe")).not.toBeInTheDocument();
  });
});
