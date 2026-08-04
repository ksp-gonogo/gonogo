import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LifeSupportSystemsComponent } from "./index";

// LifeSupportSystems reads the real `kerbalism.lifesupport` Topic (canonical
// one-arg useTelemetry), so the tests drive it through a real stream
// (setupStreamFixture) rather than the legacy MockDataSource.

interface Consumable {
  amount: number;
  capacity: number;
  rate: number;
}

interface LsState {
  food: Consumable;
  water: Consumable;
  oxygen: Consumable;
  ec: Consumable;
  pressure: number;
  co2Poisoning: number;
  comfort: number;
  livingSpace: number;
  /** 0=idle, 1=running, 2=broken, matching the old process fixture encoding. */
  processStates: {
    scrubber: number;
    waterRecycler: number;
    wasteProcessor: number;
    fuelCell: number;
  };
}

const NOMINAL: LsState = {
  food: { amount: 1.35, capacity: 1.35, rate: -0.000012035471250352793 },
  water: { amount: 0.7, capacity: 0.7, rate: -0.000006195307937675452 },
  oxygen: {
    amount: 186.9352674200827,
    capacity: 187,
    rate: -0.0017143162437546708,
  },
  ec: { amount: 446.65850563948504, capacity: 450, rate: -0.08942449474961575 },
  pressure: 0,
  co2Poisoning: 0,
  comfort: 0.3000000029802322,
  livingSpace: 0.1,
  processStates: {
    scrubber: 1,
    waterRecycler: 1,
    wasteProcessor: 1,
    fuelCell: 0,
  },
};

const DEPLETING: LsState = {
  ...NOMINAL,
  food: { amount: 0.35, capacity: 1.35, rate: -0.000036 },
  water: { amount: 0.19, capacity: 0.7, rate: -0.000019 },
  oxygen: { amount: 84.15, capacity: 187, rate: -0.0031 },
  ec: { amount: 247.5, capacity: 450, rate: -0.12 },
  co2Poisoning: 0.09,
  comfort: 0.22,
  processStates: {
    scrubber: 2,
    waterRecycler: 1,
    wasteProcessor: 1,
    fuelCell: 0,
  },
};

const CRITICAL: LsState = {
  ...NOMINAL,
  food: { amount: 0.11, capacity: 1.35, rate: -0.00004 },
  water: { amount: 0.06, capacity: 0.7, rate: -0.000021 },
  oxygen: { amount: 9.35, capacity: 187, rate: -0.006 },
  ec: { amount: 54, capacity: 450, rate: -0.15 },
  co2Poisoning: 0.65,
  comfort: 0.15,
  processStates: {
    scrubber: 2,
    waterRecycler: 1,
    wasteProcessor: 1,
    fuelCell: 2,
  },
};

function proc(resource: string, title: string, state: number) {
  return {
    resource,
    title,
    capacity: 1.67,
    running: state === 1,
    broken: state === 2,
  };
}

describe("LifeSupportSystemsComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    clearRegistry();
    stream = setupStreamFixture({
      carriedChannels: ["kerbalism.lifesupport"],
      pinnedUt: 149_489,
    });
  });

  function renderWidget(size = { w: 8, h: 13 }) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ls-test" }}>
          <LifeSupportSystemsComponent
            config={{}}
            id="ls-test"
            w={size.w}
            h={size.h}
          />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emit(ls: LsState) {
    act(() => {
      stream.emit("kerbalism.lifesupport", {
        food: ls.food,
        water: ls.water,
        oxygen: ls.oxygen,
        electricCharge: ls.ec,
        habitat: {
          pressure: ls.pressure,
          poisoning: ls.co2Poisoning,
          shielding: 0,
          livingSpace: ls.livingSpace,
          comfort: ls.comfort,
          volume: 0.798,
          surface: 3.31,
        },
        processes: [
          proc("_Scrubber", "Scrubber", ls.processStates.scrubber),
          proc(
            "_WaterRecycler",
            "Water recycler",
            ls.processStates.waterRecycler,
          ),
          proc(
            "_WasteProcessor",
            "Waste processor",
            ls.processStates.wasteProcessor,
          ),
          proc("_MonopropFuelCell", "Fuel cell", ls.processStates.fuelCell),
        ],
      });
    });
  }

  it("shows the consumable ledger and a Nominal status when nominal", async () => {
    renderWidget();
    emit(NOMINAL);
    await waitFor(() => expect(visibleText()).toMatch(/1\.35 \/ 1\.35/));
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
    await waitFor(() => expect(visibleText()).toMatch(/0\.35 \/ 1\.35/));
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();
    expect(visibleText()).toMatch(/1 broken/);
  });

  it("surfaces a Critical status when oxygen and power are low", async () => {
    renderWidget();
    emit(CRITICAL);
    await waitFor(() => expect(visibleText()).toMatch(/9\.35 \/ 187/));
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
    await waitFor(() => expect(visibleText()).toMatch(/0\.35 \/ 1\.35/));
    expect(await axe(container)).toHaveNoViolations();
  });

  // Process-agnostic regression guard (audit 2026-07-22): the widget must render
  // WHATEVER processes the profile carries, not a fixed stock id set. Ground
  // truth from the crewed ROKerbalism capture (ro-fixtures/
  // kerbalism-fixture-ro-crewed-orbit.json, ROC-MercuryCMBDB, 5 ProcessController
  // processes), 4 of the 5 are RO-specific and the old hardcoded lookup dropped
  // them. This asserts all five render by their real titles.
  it("renders every process the ROKerbalism profile carries (5 RO processes)", async () => {
    renderWidget();
    act(() => {
      stream.emit("kerbalism.lifesupport", {
        food: { amount: 1, capacity: 1, rate: -1e-5 },
        water: { amount: 1, capacity: 1, rate: -1e-5 },
        oxygen: { amount: 1, capacity: 1, rate: -1e-5 },
        electricCharge: { amount: 400, capacity: 450, rate: -0.05 },
        habitat: {
          pressure: 1,
          poisoning: 0,
          shielding: 0,
          livingSpace: 0.2,
          comfort: 0.3,
          volume: 2,
          surface: 5,
        },
        processes: [
          {
            resource: "_PressureControlOxygen",
            title: "O2 Pressure Controller",
            capacity: 1,
            running: true,
            broken: false,
          },
          {
            resource: "_NonRegenScrubber",
            title: "Non Regen LiOH Scrubber",
            capacity: 1.1,
            running: true,
            broken: false,
          },
          {
            resource: "_Scrubber",
            title: "LiOH Scrubber",
            capacity: 1.1,
            running: true,
            broken: false,
          },
          {
            resource: "_VacScrubber",
            title: "Vac Scrubber",
            capacity: 1.1,
            running: true,
            broken: false,
          },
          {
            resource: "_AdvScrubber",
            title: "Adv Vac Scrubber",
            capacity: 1.1,
            running: true,
            broken: false,
          },
        ],
      });
    });
    // All five RO process titles render, none dropped by a stock-id filter.
    expect(
      await screen.findByText("O2 Pressure Controller"),
    ).toBeInTheDocument();
    for (const title of [
      "Non Regen LiOH Scrubber",
      "LiOH Scrubber",
      "Vac Scrubber",
      "Adv Vac Scrubber",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // 5 running, 0 broken.
    expect(visibleText()).toMatch(/5 \/ 5 running/);
  });

  // The `life-support.sections` augment slot's built-in Greenhouse filler
  // (`./GreenhouseSection`, registered as a side effect of importing
  // `./index`). Kerbalism's `Greenhouse.Data` carries exactly `natural`,
  // `artificial`, and `issue`, no growth fraction, no harvest countdown,
  // so these assertions are scoped to what the fixture/wire actually carry.
  describe("greenhouse section (life-support.sections augment)", () => {
    function emitWithGreenhouse(greenhouses: unknown[]) {
      act(() => {
        stream.emit("kerbalism.lifesupport", {
          food: NOMINAL.food,
          water: NOMINAL.water,
          oxygen: NOMINAL.oxygen,
          electricCharge: NOMINAL.ec,
          habitat: {
            pressure: NOMINAL.pressure,
            poisoning: NOMINAL.co2Poisoning,
            shielding: 0,
            livingSpace: NOMINAL.livingSpace,
            comfort: NOMINAL.comfort,
            volume: 0.798,
            surface: 3.31,
          },
          processes: [
            proc("_Scrubber", "Scrubber", NOMINAL.processStates.scrubber),
            proc(
              "_WaterRecycler",
              "Water recycler",
              NOMINAL.processStates.waterRecycler,
            ),
            proc(
              "_WasteProcessor",
              "Waste processor",
              NOMINAL.processStates.wasteProcessor,
            ),
            proc(
              "_MonopropFuelCell",
              "Fuel cell",
              NOMINAL.processStates.fuelCell,
            ),
          ],
          greenhouses,
        });
      });
    }

    it("renders nothing when the vessel carries no greenhouse part", async () => {
      renderWidget();
      emitWithGreenhouse([]);
      expect(await screen.findByText("Nominal")).toBeInTheDocument();
      expect(screen.queryByText("Greenhouse")).toBeNull();
    });

    it("shows natural vs artificial light (never summed) and Growing when lit and active", async () => {
      renderWidget();
      emitWithGreenhouse([
        {
          cropResource: "Food",
          foodRatePerSec: 0.0001148431,
          natural: 1361,
          artificial: 0,
          active: true,
          issue: "",
        },
      ]);
      expect(await screen.findByText("Greenhouse")).toBeInTheDocument();
      expect(screen.getByText("Growing")).toBeInTheDocument();
      // Natural and artificial render as their own separate figures, never
      // summed into one combined "total light" number.
      expect(
        screen.getByText(/Natural 1361 W\/m.*Artificial 0 W\/m/),
      ).toBeInTheDocument();
      // No growth meter, no harvest countdown, neither concept exists in
      // Kerbalism (see GreenhouseSection's own doc comment).
      expect(screen.queryByText(/growth/i)).toBeNull();
      expect(screen.queryByText(/harvest/i)).toBeNull();
    });

    it("shows Blocked with the real blocking issue string when lighting is insufficient", async () => {
      renderWidget();
      emitWithGreenhouse([
        {
          cropResource: "Food",
          foodRatePerSec: 0,
          natural: 40,
          artificial: 120,
          active: true,
          issue: "insufficient lighting",
        },
      ]);
      expect(await screen.findByText("Blocked")).toBeInTheDocument();
      expect(screen.getByText("insufficient lighting")).toBeInTheDocument();
    });

    it("shows Off (not Blocked) when the player's own toggle is off, regardless of issue", async () => {
      renderWidget();
      emitWithGreenhouse([
        {
          cropResource: "Food",
          foodRatePerSec: 0,
          natural: 1361,
          artificial: 0,
          active: false,
          issue: "",
        },
      ]);
      expect(await screen.findByText("Off")).toBeInTheDocument();
    });

    it("has no axe violations with the greenhouse section rendered", async () => {
      const { container } = renderWidget();
      emitWithGreenhouse([
        {
          cropResource: "Food",
          foodRatePerSec: 0,
          natural: 40,
          artificial: 120,
          active: true,
          issue: "insufficient lighting",
        },
      ]);
      expect(await screen.findByText("Blocked")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
