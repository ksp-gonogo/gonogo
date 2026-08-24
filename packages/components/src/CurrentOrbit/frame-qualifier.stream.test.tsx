import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * The frame as a qualifier on the boards.
 *
 * The ruling this covers: the active frame is shown where the numbers it
 * governs are, and a readout the frame invalidates SAYS SO rather than showing
 * a number. An apsis is defined against a centre, so in a frame defined by a
 * pair of bodies an apoapsis does not exist at all.
 *
 * The distinction under test is the one an em-dash cannot carry. This widget
 * already renders `NULL_DISPLAY` for a hyperbolic orbit's absent apoapsis, and
 * that means "absent on this trajectory". Rendering the frame case the same way
 * would tell an operator their ORBIT had changed when only their FRAME had.
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

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "orbit-frame" }}>
        <CurrentOrbitComponent id="orbit-frame" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return fixture;
}

function emitOrbit(fixture: ReturnType<typeof setupStreamFixture>) {
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
}

describe("CurrentOrbit: what the view frame does to the apsis readouts", () => {
  it("says the apsides do not exist here when the frame is defined by a pair", async () => {
    const fixture = mount();
    emitOrbit(fixture);
    // RotatingPulsating: a pair rather than a centre, so no apsis is defined.
    act(() => {
      fixture.emit("system.frame", { kind: 4, centreBody: null });
    });

    await waitFor(() =>
      expect(screen.getAllByText(/no Ap here/i).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/no Pe here/i).length).toBeGreaterThan(0);
  });

  it("still renders the numbers in a frame that has a centre", async () => {
    // The contrast case. Without it the assertion above could pass because the
    // widget stopped rendering apsides at all.
    const fixture = mount();
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() =>
      expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/no Pe here/i)).not.toBeInTheDocument();
  });

  it("does not claim the apsides are missing before any frame has been reported", async () => {
    // "We have not been told what frame this is" is not "this frame has no
    // apsides". Blanking the boards on an unreported frame would suppress good
    // numbers on every install for the moment before the first sample lands.
    const fixture = mount();
    emitOrbit(fixture);

    await waitFor(() =>
      expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument();
  });
});

describe("CurrentOrbit: naming the frame that took the numbers away", () => {
  it("names the frame in force when it is why the apsides are gone", async () => {
    // The caveat alone says a quantity is missing; the name says WHY, and the
    // why is something the operator can act on by changing their view.
    const fixture = mount();
    emitOrbit(fixture);
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
  });

  it("does not caption a frame that takes nothing away", async () => {
    // A frame caption on a panel whose readouts it does not touch is a line of
    // text that explains nothing.
    const fixture = mount();
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() =>
      expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/^Frame: /)).not.toBeInTheDocument();
  });
});

describe("CurrentOrbit: the countdowns to an apsis the frame does not have", () => {
  it("suppresses the time-to-apsis rows too, not just the apsis values", async () => {
    // Found on a render, not by a test. Suppressing AP and PE while leaving
    // T-AP and T-PE counting is a countdown to an event that does not happen,
    // sitting directly under a row saying it does not exist. The widget is
    // 9x18 here because the progress rows only render at six rows or more.
    const fixture = mount();
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      });
    });

    await waitFor(() =>
      expect(screen.getAllByText(/no Ap here/i).length).toBeGreaterThan(1),
    );
    expect(screen.getAllByText(/no Pe here/i).length).toBeGreaterThan(1);
  });
});
