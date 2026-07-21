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
import { LifeSupportSystemsComponent } from "./index";

const KEYS: DataKey[] = [
  "ls.food.amount",
  "ls.food.capacity",
  "ls.food.rate",
  "ls.water.amount",
  "ls.water.capacity",
  "ls.water.rate",
  "ls.oxygen.amount",
  "ls.oxygen.capacity",
  "ls.oxygen.rate",
  "ls.ec.amount",
  "ls.ec.capacity",
  "ls.ec.rate",
  "ls.pressure",
  "ls.co2Poisoning",
  "ls.comfort",
  "ls.livingSpace",
  "ls.climatization",
  "ls.process.scrubber",
  "ls.process.waterRecycler",
  "ls.process.wasteProcessor",
  "ls.process.fuelCell",
].map((key) => ({ key }));

type LsFixture = Record<string, number>;

const NOMINAL: LsFixture = {
  "ls.food.amount": 1.35,
  "ls.food.capacity": 1.35,
  "ls.food.rate": -0.000012035471250352793,
  "ls.water.amount": 0.7,
  "ls.water.capacity": 0.7,
  "ls.water.rate": -0.000006195307937675452,
  "ls.oxygen.amount": 186.9352674200827,
  "ls.oxygen.capacity": 187,
  "ls.oxygen.rate": -0.0017143162437546708,
  "ls.ec.amount": 446.65850563948504,
  "ls.ec.capacity": 450,
  "ls.ec.rate": -0.08942449474961575,
  "ls.pressure": 0,
  "ls.co2Poisoning": 0,
  "ls.comfort": 0.3000000029802322,
  "ls.livingSpace": 0.1,
  "ls.climatization": 0.00004937349288767713,
  "ls.process.scrubber": 1,
  "ls.process.waterRecycler": 1,
  "ls.process.wasteProcessor": 1,
  "ls.process.fuelCell": 0,
};

const DEPLETING: LsFixture = {
  ...NOMINAL,
  "ls.food.amount": 0.35,
  "ls.food.rate": -0.000036,
  "ls.water.amount": 0.19,
  "ls.water.rate": -0.000019,
  "ls.oxygen.amount": 84.15,
  "ls.oxygen.rate": -0.0031,
  "ls.ec.amount": 247.5,
  "ls.ec.rate": -0.12,
  "ls.co2Poisoning": 0.09,
  "ls.comfort": 0.22,
  "ls.climatization": 0.06,
  "ls.process.scrubber": 2,
};

const CRITICAL: LsFixture = {
  ...NOMINAL,
  "ls.food.amount": 0.11,
  "ls.food.rate": -0.00004,
  "ls.water.amount": 0.06,
  "ls.water.rate": -0.000021,
  "ls.oxygen.amount": 9.35,
  "ls.oxygen.rate": -0.006,
  "ls.ec.amount": 54,
  "ls.ec.rate": -0.15,
  "ls.co2Poisoning": 0.65,
  "ls.comfort": 0.15,
  "ls.climatization": 0.22,
  "ls.process.scrubber": 2,
  "ls.process.fuelCell": 2,
};

describe("LifeSupportSystemsComponent", () => {
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

  function emit(fixture: LsFixture) {
    act(() => {
      for (const [key, value] of Object.entries(fixture)) {
        source.emit(key, value);
      }
    });
  }

  function renderWidget(size = { w: 8, h: 13 }) {
    return render(
      <DashboardItemContext.Provider value={{ instanceId: "ls-test" }}>
        <LifeSupportSystemsComponent
          config={{}}
          id="ls-test"
          w={size.w}
          h={size.h}
        />
      </DashboardItemContext.Provider>,
    );
  }

  it("shows the consumable ledger and a Nominal status when nominal", async () => {
    renderWidget();
    emit(NOMINAL);
    await waitFor(() => {
      expect(screen.getByText(/1\.35 \/ 1\.35/)).toBeInTheDocument();
    });
    expect(screen.getByText("Nominal")).toBeInTheDocument();
    expect(screen.getByText("Unpressurized")).toBeInTheDocument();
    // Food fraction is 100% -> go tone.
    expect(screen.getByRole("meter", { name: "Food" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });

  it("flags a broken process and a Degraded status when depleting", async () => {
    renderWidget();
    emit(DEPLETING);
    await waitFor(() => {
      expect(screen.getByText(/0\.35 \/ 1\.35/)).toBeInTheDocument();
    });
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();
    expect(screen.getByText(/1 broken/)).toBeInTheDocument();
  });

  it("surfaces a Critical status when oxygen and power are low", async () => {
    renderWidget();
    emit(CRITICAL);
    await waitFor(() => {
      expect(screen.getByText(/9\.35 \/ 187/)).toBeInTheDocument();
    });
    expect(screen.getByText("Critical")).toBeInTheDocument();
    // Power fraction 54/450 = 12% -> nogo.
    expect(screen.getByRole("meter", { name: "Power" })).toHaveAttribute(
      "aria-valuenow",
      "12",
    );
  });

  it("has no axe violations", async () => {
    const { container } = renderWidget();
    emit(DEPLETING);
    await waitFor(() => {
      expect(screen.getByText(/0\.35 \/ 1\.35/)).toBeInTheDocument();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
