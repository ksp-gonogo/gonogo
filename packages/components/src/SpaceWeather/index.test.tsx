import type { DataKey } from "@ksp-gonogo/core";
import {
  clearRegistry,
  DashboardItemContext,
  MockDataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { SpaceWeatherComponent } from "./index";

const KEYS: DataKey[] = [
  "sw.radiationRadPerHour",
  "sw.stormState",
  "sw.stormTimeSec",
  "sw.innerBelt",
  "sw.outerBelt",
  "sw.magnetosphere",
  "sw.blackout",
  "sw.shieldingValue",
  "sw.shieldingCapacity",
  "sw.altitudeM",
  "sw.ut",
].map((key) => ({ key }));

type SwFixture = Record<string, number>;

const NOMINAL: SwFixture = {
  "sw.radiationRadPerHour": 0.0143,
  "sw.stormState": 0,
  "sw.stormTimeSec": -1,
  "sw.innerBelt": 0,
  "sw.outerBelt": 0,
  "sw.magnetosphere": 1,
  "sw.blackout": 0,
  "sw.shieldingValue": 3.308,
  "sw.shieldingCapacity": 3.308,
  "sw.altitudeM": 100_000,
  "sw.ut": 149_489,
};

const INNER_BELT: SwFixture = {
  ...NOMINAL,
  "sw.radiationRadPerHour": 10.376,
  "sw.innerBelt": 1,
  "sw.shieldingValue": 1.2,
  "sw.altitudeM": 1_300_000,
};

const STORM_PEAK: SwFixture = {
  ...NOMINAL,
  "sw.radiationRadPerHour": 5.0,
  "sw.stormState": 2,
  "sw.stormTimeSec": 900,
  "sw.magnetosphere": 0,
  "sw.blackout": 1,
  "sw.shieldingValue": 0.8,
};

describe("SpaceWeatherComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    buffered.disconnect();
  });

  function emit(fixture: SwFixture) {
    act(() => {
      for (const [key, value] of Object.entries(fixture)) {
        source.emit(key, value);
      }
    });
  }

  function renderWidget(size = { w: 8, h: 11 }) {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "sw-test" }}>
        <SpaceWeatherComponent config={{}} id="sw-test" w={size.w} h={size.h} />
      </DashboardItemContext.Provider>,
    );
  }

  it("shows the habitat dose rate and a Sheltered status when nominal", async () => {
    renderWidget();
    emit(NOMINAL);
    await waitFor(() => {
      expect(screen.getByText("0.014 rad/h")).toBeInTheDocument();
    });
    expect(screen.getByText("Sheltered")).toBeInTheDocument();
    expect(screen.getByText("No storm activity")).toBeInTheDocument();
  });

  it("flags the inner belt with a take-cover status and lit belt tag", async () => {
    renderWidget();
    emit(INNER_BELT);
    await waitFor(() => {
      expect(screen.getByText("10.38 rad/h")).toBeInTheDocument();
    });
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
    await waitFor(() => {
      expect(screen.getByText("5.00 rad/h")).toBeInTheDocument();
    });
    expect(screen.getByText(/Storm in progress/)).toBeInTheDocument();
    expect(screen.getByText("Comms blackout")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderWidget();
    emit(INNER_BELT);
    await waitFor(() => {
      expect(screen.getByText("10.38 rad/h")).toBeInTheDocument();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
