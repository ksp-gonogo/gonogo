import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * The frame as a qualifier on a LENGTH, which is a different rule from the one
 * that governs an apsis.
 *
 * A rotating-pulsating frame holds its two primaries' separation fixed, so its
 * length unit varies with time. A semi-major axis in that frame still EXISTS,
 * it is simply measured in units that move, so it is labelled rather than
 * suppressed. An apsis in the same frame does not exist at all and must show no
 * number. Getting those two the same way round is the point of the rule living
 * in one place.
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "system.frame",
];

function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
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
    // Labelled, NOT suppressed: the quantity exists, and an operator who knows
    // the units move can still read it.
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
    // The frame is named, so the caveat points at something the operator can
    // change rather than reading as an unexplained warning.
    expect(screen.getByText(/Kerbol-Kerbin Lagrange/)).toBeTruthy();
  });

  it("says nothing about units in a frame whose lengths are lengths", async () => {
    // The contrast case. Without it, the assertion above could pass because the
    // caption rendered unconditionally.
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
    // Unknown is not invalid. A caption on every install for the moment before
    // the first frame sample lands would be a warning about nothing.
    setup();

    await waitFor(() => expect(screen.getByText(/682/)).toBeTruthy());
    expect(
      screen.queryByText(/Kerbol-Kerbin Lagrange/),
    ).not.toBeInTheDocument();
  });
});
