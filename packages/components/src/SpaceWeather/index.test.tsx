import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceWeatherComponent } from "./index";

// SpaceWeather reads the real `kerbalism.spaceweather` Topic (canonical
// one-arg useTelemetry) plus `vessel.flight` for the belt-ring altitude, so the
// tests drive it through a real stream (setupStreamFixture) — not the legacy
// MockDataSource. Radiation is emitted rad/s (as the mod does); the widget
// multiplies by 3600 for the rad/h readout.

interface SwState {
  radiationRadPerHour: number;
  stormState: 0 | 1 | 2;
  innerBelt?: boolean;
  outerBelt?: boolean;
  magnetosphere?: boolean;
  blackout?: boolean;
  shieldingValue: number;
  shieldingCapacity: number;
  altitudeM: number;
}

const NOMINAL: SwState = {
  radiationRadPerHour: 0.0143,
  stormState: 0,
  magnetosphere: true,
  shieldingValue: 3.308,
  shieldingCapacity: 3.308,
  altitudeM: 100_000,
};

const INNER_BELT: SwState = {
  ...NOMINAL,
  radiationRadPerHour: 10.376,
  innerBelt: true,
  shieldingValue: 1.2,
  altitudeM: 1_300_000,
};

const STORM_PEAK: SwState = {
  ...NOMINAL,
  radiationRadPerHour: 5.0,
  stormState: 2,
  magnetosphere: false,
  blackout: true,
  shieldingValue: 0.8,
};

describe("SpaceWeatherComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearRegistry();
    stream = setupStreamFixture({
      carriedChannels: ["kerbalism.spaceweather", "vessel.flight"],
      pinnedUt: 149_489,
    });
  });

  function renderWidget(size = { w: 8, h: 11 }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "sw-test" }}>
          <SpaceWeatherComponent
            config={{}}
            id="sw-test"
            w={size.w}
            h={size.h}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emit(sw: SwState) {
    act(() => {
      stream.emit("kerbalism.spaceweather", {
        radiationRadPerSecond: sw.radiationRadPerHour / 3600,
        habitatRadiationRadPerSecond: sw.radiationRadPerHour / 3600,
        magnetosphere: sw.magnetosphere ?? false,
        innerBelt: sw.innerBelt ?? false,
        outerBelt: sw.outerBelt ?? false,
        stormIncoming: sw.stormState === 1,
        stormInProgress: sw.stormState === 2,
        blackout: sw.blackout ?? false,
        inSunlight: true,
        shieldingAmount: sw.shieldingValue,
        shieldingCapacity: sw.shieldingCapacity,
      });
      stream.emit("vessel.flight", {
        altitudeAsl: sw.altitudeM,
        altitudeTerrain: sw.altitudeM,
      });
    });
  }

  it("shows the habitat dose rate and a Sheltered status when nominal", async () => {
    renderWidget();
    emit(NOMINAL);
    expect(await screen.findByText("0.014 rad/h")).toBeInTheDocument();
    expect(screen.getByText("Sheltered")).toBeInTheDocument();
    expect(screen.getByText("No storm activity")).toBeInTheDocument();
  });

  it("flags the inner belt with a take-cover status and lit belt tag", async () => {
    renderWidget();
    emit(INNER_BELT);
    expect(await screen.findByText("10.38 rad/h")).toBeInTheDocument();
    expect(screen.getByText("Take cover")).toBeInTheDocument();
    // The shielding meter reflects the fraction (1.2 / 3.308 ≈ 36%).
    expect(screen.getByRole("meter", { name: "Shielding" })).toHaveAttribute(
      "aria-valuenow",
      "36",
    );
  });

  it("surfaces storm-in-progress and comms blackout at storm peak", async () => {
    renderWidget();
    emit(STORM_PEAK);
    expect(await screen.findByText("5.00 rad/h")).toBeInTheDocument();
    expect(screen.getByText(/Storm in progress/)).toBeInTheDocument();
    expect(screen.getByText("Comms blackout")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderWidget();
    emit(INNER_BELT);
    expect(await screen.findByText("10.38 rad/h")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
