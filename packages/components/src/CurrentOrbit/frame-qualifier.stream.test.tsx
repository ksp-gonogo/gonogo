import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ReadingProbe } from "../test/ReadingProbe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import rotatingControlFrame from "./__fixtures__/rotating-control-frame.json";
import type { CurrentOrbitConfig } from "./config";
import { CurrentOrbitComponent } from "./index";

/**
 * An apsis needs a centre. Current Orbit follows the Control Frame while it
 * has one, and otherwise reads the vessel's elements about its own reference
 * body, naming that frame so the panel never claims to be in the game's.
 */

const KERBOL_SYSTEM = rotatingControlFrame._stream.emits.find(
  (e) => e.channel === "system.bodies",
)?.value;

function mount({
  probe = false,
  config,
}: {
  probe?: boolean;
  config?: CurrentOrbitConfig;
} = {}) {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      {probe && <ReadingProbe topic="system.frame" />}
      <DashboardItemContext.Provider value={{ instanceId: "orbit-frame" }}>
        <CurrentOrbitComponent id="orbit-frame" w={9} h={18} config={config} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return fixture;
}

function emitOrbit(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.emit("system.bodies", KERBOL_SYSTEM);
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
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

describe("CurrentOrbit: following the Control Frame while it has a centre", () => {
  it("renders the numbers with no frame named in a frame centred on the vessel's body", async () => {
    const fixture = mount({ probe: true });
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await screen.findByText("system.frame: observed");
    expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Frame: /)).not.toBeInTheDocument();
  });

  it("follows a centred frame of another kind without naming it", async () => {
    const fixture = mount({ probe: true });
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 2, centreBody: "Kerbin" });
    });

    await screen.findByText("system.frame: observed");
    expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Frame: /)).not.toBeInTheDocument();
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

describe("CurrentOrbit: a Control Frame with no centre", () => {
  it("reads about the vessel's body under a rotating pair, and names that frame", async () => {
    const fixture = mount();
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbin",
        secondaryBody: "Mun",
      });
    });

    await screen.findByText("Frame: Kerbin-Centred Inertial");
    expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no Pe here/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lagrange/)).not.toBeInTheDocument();
  });

  it("does the same in the target frame, which reports no kind", async () => {
    const fixture = mount();
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 0, targetFrameSelected: true });
    });

    await screen.findByText("Frame: Kerbin-Centred Inertial");
    expect(screen.queryByText(/no Ap here/i)).not.toBeInTheDocument();
  });
});

describe("CurrentOrbit: a frame pinned in its config", () => {
  const PINNED: CurrentOrbitConfig = {
    frame: { kind: "body-centred-inertial" },
  };

  it("names nothing while the Control Frame is the same frame", async () => {
    const fixture = mount({ probe: true, config: PINNED });
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await screen.findByText("system.frame: observed");
    expect(screen.queryByText(/^Frame: /)).not.toBeInTheDocument();
  });

  it("names the pinned frame when the Control Frame is a different one", async () => {
    const fixture = mount({ config: PINNED });
    emitOrbit(fixture);
    act(() => {
      fixture.emit("system.frame", { kind: 2, centreBody: "Kerbin" });
    });

    await screen.findByText("Frame: Kerbin-Centred Inertial");
  });

  it("names the pinned frame before any Control Frame is reported", async () => {
    // Nothing says the game's view is the same frame, so the panel does not imply it.
    const fixture = mount({ config: PINNED });
    emitOrbit(fixture);

    await screen.findByText("Frame: Kerbin-Centred Inertial");
  });
});
