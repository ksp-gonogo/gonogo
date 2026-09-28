import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ReadingProbe } from "../test/ReadingProbe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * A readout the view frame invalidates says so instead of showing a number.
 * The null dash already means "absent on this trajectory"; showing the frame case the same way would tell an operator their orbit changed when only their frame did.
 */

function mount({ probe = false }: { probe?: boolean } = {}) {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      {probe && <ReadingProbe topic="system.frame" />}
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
    // The contrast case, so the test above cannot pass by never rendering apsides.
    const fixture = mount({ probe: true });
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await screen.findByText("system.frame: observed");
    expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no Pe here/i)).not.toBeInTheDocument();
  });

  it("does not claim the apsides are missing before any frame has been reported", async () => {
    // An unreported frame is not a frame without apsides.
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
    // The caveat alone says a quantity is missing; the name says WHY, and the why is something the operator can act on by changing their view.
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
    // A frame caption on a panel whose readouts it does not touch is a line of text that explains nothing.
    const fixture = mount({ probe: true });
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await screen.findByText("system.frame: observed");
    expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Frame: /)).not.toBeInTheDocument();
  });
});

describe("CurrentOrbit: the countdowns to an apsis the frame does not have", () => {
  it("suppresses the time-to-apsis rows too, not just the apsis values", async () => {
    // A countdown to an apsis that does not exist counts to an event that never happens; the progress rows need six rows or more.
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
