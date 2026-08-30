import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

/**
 * The preview's projected apsides: what a planned burn would leave the craft on.
 *
 * <p><b>These rows had no coverage at all.</b> Forcing a new branch through them
 * permanently on left the whole 111-test ManeuverPlanner suite passing, which is
 * how the gap was found: nothing anywhere asserted that a projection renders, or
 * what it renders. A widget's headline output was unobserved.</p>
 *
 * <p>The fixture needs <c>system.bodies</c> as well as an orbit, because the
 * rows are altitudes and an altitude is a radius minus the body's. Without it
 * the projection still computes and the numbers are radii, which look entirely
 * plausible and are wrong by six hundred kilometres.</p>
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

    // Altitudes, not radii: 747 km above a 600 km body, from a 700 km sma. A
    // radius would read 1347 km and look just as much like a number.
    await waitFor(() => expect(screen.getByText(/New Ap/)).toBeTruthy());
    expect(screen.getByText(/747/)).toBeTruthy();
    expect(screen.getByText(/New Pe/)).toBeTruthy();
    expect(screen.getByText(/707/)).toBeTruthy();
  });

  it("says escape rather than projecting apsides a burn does not leave", async () => {
    // The contrast case, and it is what gives the first test meaning: without
    // it, an assertion that apsides render could pass on a widget that renders
    // them unconditionally, including for a burn that leaves no orbit to have
    // apsides on.
    //
    // Also a correction worth recording: the DEFAULT preset already computes a
    // burn, so "no input" is not the no-projection case. Projecting nothing
    // takes a burn big enough to escape.
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
    // The burn FIRST, then the frame. `StubTransport.emit` is
    // subscription-gated, and these rows only mount once there is a projection
    // to render, so a frame emitted before the burn reaches nothing and the
    // test measures a component that never heard it.
    await planABurn();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbol",
        secondaryBody: "Kerbin",
      });
    });

    // Named, so the operator sees WHICH frame took them away and that it is
    // their own view rather than the plan being wrong.
    await waitFor(() =>
      expect(screen.getByText(/none in Kerbol-Kerbin Lagrange/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/New Ap/)).not.toBeInTheDocument();
  });

  it("still quotes them in a frame that has a centre", async () => {
    // The contrast: without it, the assertion above could pass because the rows
    // stopped rendering for an unrelated reason.
    const fixture = setup();
    // Burn first, then frame, for the subscription-gating reason above. Emitted
    // the other way round this test passes whether the frame arrived or not,
    // which makes it indistinguishable from the no-frame case and therefore
    // proof of nothing.
    await planABurn();
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });

    await waitFor(() => expect(screen.getByText(/747/)).toBeTruthy());
    expect(screen.queryByText(/none in /i)).not.toBeInTheDocument();
  });

  it("reports an escaping burn as escaping even in a frame with no apsides", async () => {
    // A plan that does not work outranks a view that cannot describe one that
    // does. Getting this order wrong would tell an operator their frame was the
    // problem when their burn was.
    const fixture = setup();
    // A modest burn first, so the rows mount and the frame is heard, and only
    // THEN the burn that escapes. Emitting the frame while nothing is
    // subscribed would leave this asserting precedence in a frame the component
    // never received, which is no test of precedence at all.
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
