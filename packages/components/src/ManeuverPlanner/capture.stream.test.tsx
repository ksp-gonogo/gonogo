import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

const MUN_MU = 6.5138398e10;
const V_INF = 300;
const SMA = -MUN_MU / V_INF ** 2;
const ECC = 1 - 210_000 / SMA;

/**
 * A Mun approach, 300 m/s at infinity and 10 km over the surface at periapsis,
 * caught on the inbound leg (3.07 Mm out, 364 m/s, 7238 s from periapsis).
 */
function mount(timeToPe: number, orbitalSpeed: number) {
  const fixture = setupStreamFixture({ pinnedUt: 90_000, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mnv-capture" }}>
        <ManeuverPlannerComponent id="mnv-capture" config={{}} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", {
      bodies: [
        {
          index: 2,
          name: "Mun",
          radius: 200_000,
          sphereOfInfluence: 4_000_000,
        },
      ],
    });
    fixture.emit("vessel.flight", { orbitalSpeed });
    fixture.emit("vessel.propulsion", {
      totalMass: 5,
      dryMass: 3,
      currentThrust: 0,
      availableThrust: 60,
    });
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 2,
        sma: SMA,
        ecc: ECC,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: timeToPe > 0 ? -3 : 3,
        timeToPe,
        epoch: 90_000,
        mu: MUN_MU,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      },
      { quality: Quality.Loaded },
    );
  });
  return view;
}

describe("Maneuver Planner on a hyperbolic approach", () => {
  it("plans a retrograde capture burn at periapsis", async () => {
    const { container } = mount(7237.6, 363.9323652526868);
    await waitFor(() =>
      expect(screen.getByText("Burn in")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Hyperbolic trajectory")).toBeNull();
    expect(screen.getByText("Capture at Periapsis")).toBeInTheDocument();
    expect(screen.getByLabelText("Orbit alt")).toHaveValue(10);
    // Circular at the 10 km periapsis altitude, the ΔV being 285.9 m/s.
    expect(screen.getByText("New Ecc").nextElementSibling?.textContent).toBe(
      "0.0000",
    );
    expect(screen.getByText("ΔV").nextElementSibling?.textContent).toMatch(
      /285\.9/,
    );
    await expectNoA11yViolations(container);
  });

  async function typeAltitude(text: string) {
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Orbit alt");
    await user.clear(field);
    await user.type(field, text);
    await user.tab();
    return user;
  }

  it("plans the capture and a circularising burn at the altitude typed", async () => {
    mount(7237.6, 363.9323652526868);
    await typeAltitude("800");
    expect(await screen.findByText("Burn 2")).toBeInTheDocument();
    const total = Number.parseFloat(
      screen.getByText("Total ΔV").nextElementSibling?.textContent ?? "",
    );
    // The capture to an 800 km apoapsis is 126.8 m/s, and circularising there adds more.
    expect(total).toBeGreaterThan(126.8);
    expect(total).toBeLessThan(285.9);
  });

  it("stops after the capture burn when the circularise toggle is off", async () => {
    mount(7237.6, 363.9323652526868);
    const user = await typeAltitude("800");
    await screen.findByText("Burn 2");
    await user.click(screen.getByRole("button", { name: "Circularise" }));
    await waitFor(() => expect(screen.queryByText("Burn 2")).toBeNull());
    expect(screen.getByText("New Ap").nextElementSibling?.textContent).toMatch(
      /800/,
    );
    expect(screen.getByText("ΔV").nextElementSibling?.textContent).toMatch(
      /126\.8/,
    );
  });

  it("plans a target below the approach periapsis as a retrograde second burn", async () => {
    mount(7237.6, 363.9323652526868);
    await typeAltitude("5");
    expect(await screen.findByText("Burn 2")).toBeInTheDocument();
    expect(screen.queryByText("Below the surface")).toBeNull();
  });

  it("states the surface when the target is below it", async () => {
    mount(7237.6, 363.9323652526868);
    await typeAltitude("-5");
    expect(await screen.findByText("Below the surface")).toBeInTheDocument();
    expect(screen.queryByText("Burn in")).toBeNull();
  });

  it("states the sphere of influence when the target is outside it", async () => {
    mount(7237.6, 363.9323652526868);
    await typeAltitude("5000");
    expect(
      await screen.findByText("Outside the sphere of influence"),
    ).toBeInTheDocument();
  });

  it("explains what to do once periapsis is behind the vessel", async () => {
    mount(-100, 363.9323652526868);
    expect(
      await screen.findByText("Hyperbolic trajectory"),
    ).toBeInTheDocument();
    expect(screen.getByText(/before periapsis/i)).toBeInTheDocument();
    expect(screen.queryByText("Burn in")).toBeNull();
  });
});
