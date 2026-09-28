import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * A rotating-pulsating frame's length unit moves with time, so a semi-major
 * axis in it is labelled rather than suppressed; an apsis in the same frame
 * does not exist and shows no number.
 */

function setup() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sma-frame" }}>
        <SemiMajorAxisComponent id="sma-frame" w={5} h={6} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.orbit", {
      sma: 682500,
      ecc: 0.00367,
      inc: 0.3,
      argPe: 12.5,
      mu: 3.5316e12,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
    });
  });
  return fixture;
}

describe("SemiMajorAxis: what a pulsating frame does to a length", () => {
  it("still shows the number, and names the frame its units move with", async () => {
    // Labelled, not suppressed: the quantity exists.
    const fixture = setup();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      });
    });

    await waitFor(() =>
      expect(screen.getByText(/Kerbol-Kerbin Lagrange/)).toBeTruthy(),
    );
    // The frame is named, so the caveat points at something the operator can change.
    expect(screen.getByText(/Kerbol-Kerbin Lagrange/)).toBeTruthy();
  });

  it("says nothing about units in a frame whose lengths are lengths", async () => {
    // The contrast case, so the caption above cannot be unconditional.
    const fixture = setup();
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() => expect(screen.getByText(/682/)).toBeTruthy());
    expect(
      screen.queryByText(/Kerbol-Kerbin Lagrange/),
    ).not.toBeInTheDocument();
  });

  it("says nothing before any frame has been reported", async () => {
    // Unknown is not invalid: no caption before the first frame sample lands.
    setup();

    await waitFor(() => expect(screen.getByText(/682/)).toBeTruthy());
    expect(
      screen.queryByText(/Kerbol-Kerbin Lagrange/),
    ).not.toBeInTheDocument();
  });
});
