import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * The preview's projected apsides. The fixture carries `system.bodies` because
 * the rows are altitudes; without a body radius they would print plausible
 * radii.
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
  "vessel.maneuver",
  "dv.stages",
  "system.frame",
];

const UT = 1_000_000;

const mounted: Array<() => void> = [];
afterEach(() => {
  for (const unmount of mounted) unmount();
  mounted.length = 0;
});

function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: UT,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-projected" }}>
        <ManeuverPlannerComponent id="mnv-projected" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  mounted.push(view.unmount);
  act(() => {
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      sma: 700000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: UT,
      mu: 3.5316e12,
      // Without a stated horizon the conic model withdraws and the current apsides go with it.
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
    });
    fixture.emit("system.bodies", {
      bodies: [
        { index: 1, name: "Kerbin", gravParameter: 3.5316e12, radius: 600000 },
      ],
    });
  });
  return fixture;
}

/** Drives a real burn, which is what makes a projection exist to render. */
async function planABurn() {
  expect(await screen.findByText("Preview")).toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByRole("combobox") as HTMLSelectElement,
    "custom-apo",
  );
  const prograde = screen
    .getByText("Prograde")
    .parentElement?.querySelector("input") as HTMLInputElement;
  await userEvent.type(prograde, "42");
}

describe("ManeuverPlanner: the projected apsides", () => {
  it("shows the orbit a planned burn would leave the craft on", async () => {
    setup();
    await planABurn();

    // Apsis radii of 747 km and 707 km above a 600 km body are altitudes of 147 km and 107 km.
    await waitFor(() => expect(screen.getByText(/New Ap/)).toBeTruthy());
    expect(screen.getByText(/147\.4/)).toBeTruthy();
    expect(screen.getByText(/New Pe/)).toBeTruthy();
    expect(screen.getByText(/107\.0/)).toBeTruthy();
  });

  it("says escape rather than projecting apsides a burn does not leave", async () => {
    // The default preset already computes a burn, so no projection takes a burn big enough to escape.
    setup();
    expect(await screen.findByText("Preview")).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole("combobox") as HTMLSelectElement,
      "custom-apo",
    );
    const prograde = screen
      .getByText("Prograde")
      .parentElement?.querySelector("input") as HTMLInputElement;
    await userEvent.type(prograde, "9000");

    await waitFor(() =>
      expect(screen.getByText(/escape \/ invalid/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/New Ap/)).not.toBeInTheDocument();
  });
});

describe("ManeuverPlanner: the view frame and the projected apsides", () => {
  it("says the projected apsides do not exist in a frame defined by a pair", async () => {
    const fixture = setup();
    // Burn first: the rows subscribe only once a projection exists, and StubTransport delivers only to subscribers.
    await planABurn();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      });
    });

    await waitFor(() =>
      expect(screen.getByText(/none in Kerbol-Kerbin Lagrange/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/New Ap/)).not.toBeInTheDocument();
  });

  it("still quotes them in a frame that has a centre", async () => {
    // The control for the test above.
    const fixture = setup();
    // Burn first, for the subscription reason above.
    await planABurn();
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() => expect(screen.getByText(/147\.4/)).toBeTruthy());
    expect(screen.queryByText(/none in /i)).not.toBeInTheDocument();
  });

  it("reports an escaping burn as escaping even in a frame with no apsides", async () => {
    // A plan that does not work outranks a view that cannot describe one.
    const fixture = setup();
    // A modest burn first so the rows mount and hear the frame, then the escaping one.
    await planABurn();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/none in Kerbol-Kerbin Lagrange/i)).toBeTruthy(),
    );

    const prograde = screen
      .getByText("Prograde")
      .parentElement?.querySelector("input") as HTMLInputElement;
    await userEvent.type(prograde, "9000");

    await waitFor(() =>
      expect(screen.getByText(/escape \/ invalid/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/none in /i)).not.toBeInTheDocument();
  });
});
