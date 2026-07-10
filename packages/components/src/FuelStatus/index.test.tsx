import type { DataKey } from "@gonogo/core";
import {
  clearAugments,
  clearRegistry,
  MockDataSource,
  registerAugment,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FuelStatusComponent } from "./index";

const FUEL_KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.currentStage" },
  { key: "dv.stageCount" },
  { key: "dv.stages" },
  { key: "dv.totalDVVac" },
  { key: "dv.totalDVASL" },
  { key: "dv.totalDVActual" },
  { key: "dv.totalBurnTime" },
  { key: "r.resource[LiquidFuel]" },
  { key: "r.resourceMax[LiquidFuel]" },
  { key: "r.resourceCurrent[LiquidFuel]" },
  { key: "r.resourceCurrentMax[LiquidFuel]" },
  { key: "r.resource[Oxidizer]" },
  { key: "r.resourceMax[Oxidizer]" },
  { key: "r.resourceCurrent[Oxidizer]" },
  { key: "r.resourceCurrentMax[Oxidizer]" },
  { key: "r.resource[MonoPropellant]" },
  { key: "r.resourceMax[MonoPropellant]" },
  { key: "r.resourceCurrent[MonoPropellant]" },
  { key: "r.resourceCurrentMax[MonoPropellant]" },
  { key: "r.resource[XenonGas]" },
  { key: "r.resourceMax[XenonGas]" },
  { key: "r.resourceCurrent[XenonGas]" },
  { key: "r.resourceCurrentMax[XenonGas]" },
  { key: "r.resource[ElectricCharge]" },
  { key: "r.resourceMax[ElectricCharge]" },
  { key: "r.resourceCurrent[ElectricCharge]" },
  { key: "r.resourceCurrentMax[ElectricCharge]" },
];

function makeStage(stage: number, fuelMass: number): Record<string, number> {
  // Minimal stage fixture — only fuelMass is exercised by the widget; other
  // fields present-and-zero so the shape matches what Telemachus emits.
  return {
    stage,
    fuelMass,
    stageMass: fuelMass,
    dryMass: 0,
    startMass: fuelMass,
    endMass: 0,
    burnTime: 0,
    deltaVVac: 0,
    deltaVASL: 0,
    deltaVActual: 0,
    TWRVac: 0,
    TWRASL: 0,
    TWRActual: 0,
    ispVac: 0,
    ispASL: 0,
    ispActual: 0,
    thrustVac: 0,
    thrustASL: 0,
    thrustActual: 0,
  };
}

describe("FuelStatusComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: FUEL_KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    clearAugments();
    buffered.disconnect();
  });

  function primeFlight(): void {
    // FlightDetector gates sample persistence on name + missionTime arriving;
    // emit them first so useDataValue replays the later emits to subscribers.
    source.emit("v.name", "Kerbal X");
    source.emit("v.missionTime", 0);
  }

  it("renders a bar for each resource with a non-zero max", () => {
    const { container, queryByText } = render(
      <FuelStatusComponent config={{}} id="fuel-test" />,
    );

    act(() => {
      primeFlight();
      // Only LF + Ox are present on this vessel; RCS and friends stay at 0.
      source.emit("r.resourceCurrent[LiquidFuel]", 600);
      source.emit("r.resourceCurrentMax[LiquidFuel]", 1200);
      source.emit("r.resourceCurrent[Oxidizer]", 1000);
      source.emit("r.resourceCurrentMax[Oxidizer]", 1467);
    });

    expect(queryByText("Liquid Fuel")).not.toBeNull();
    expect(queryByText("Oxidizer")).not.toBeNull();
    // RCS / Xenon / Power all have max=0 → rows hidden.
    expect(queryByText("RCS")).toBeNull();
    expect(queryByText("Xenon")).toBeNull();
    expect(queryByText("Power")).toBeNull();

    // 600/1200 on LF → 50% fill (width: 50%). Look for the BarFill inline style.
    const fills = Array.from(
      container.querySelectorAll("div[style*='width']"),
    ).map((el) => (el as HTMLElement).style.width);
    expect(fills).toContain("50%");
  });

  it("shows RCS (vessel-wide) whenever monoprop max > 0, even with empty stage slot", () => {
    const { queryByText } = render(
      <FuelStatusComponent config={{}} id="fuel-test" />,
    );

    act(() => {
      primeFlight();
      // Stage has no monoprop, but the vessel carries a full RCS tank up top.
      source.emit("r.resource[MonoPropellant]", 120);
      source.emit("r.resourceMax[MonoPropellant]", 120);
      source.emit("r.resourceCurrent[MonoPropellant]", 0);
      source.emit("r.resourceCurrentMax[MonoPropellant]", 0);
    });

    expect(queryByText("RCS")).not.toBeNull();
  });

  it("renders the stage stack with the current stage highlighted", () => {
    const { container } = render(
      <FuelStatusComponent config={{}} id="fuel-test" />,
    );

    act(() => {
      primeFlight();
      source.emit("v.currentStage", 1);
      source.emit("dv.stageCount", 3);
      // Telemachus emits stages high → low (current-top-of-stack first).
      source.emit("dv.stages", [
        makeStage(2, 8000),
        makeStage(1, 4400),
        makeStage(0, 1200),
      ]);
    });

    // StageLabel spans render as leaf elements with text content like
    // "  S0" (inactive) or "▶ S1" (active).
    const stageTexts = Array.from(container.querySelectorAll("span"))
      .map((el) => el.textContent ?? "")
      .filter((t) => /^[▶ ] S\d$/.test(t));
    expect(stageTexts).toEqual(["  S2", "▶ S1", "  S0"]);
  });

  // Regression: at 21:08 BST on 2026-05-17 the widget crashed with
  // `twr.toFixed is not a function`. Telemachus had emitted a stage row
  // mid-staging where TWR/ΔV fields were null instead of numbers. The
  // crash took the entire widget down behind an error boundary.
  it("survives a stage row with non-numeric TWR / ΔV", () => {
    const { container, queryAllByText } = render(
      <FuelStatusComponent config={{}} id="fuel-test" />,
    );

    act(() => {
      primeFlight();
      source.emit("v.currentStage", 1);
      source.emit("dv.stageCount", 2);
      source.emit("dv.totalDVActual", 4200);
      source.emit("dv.totalBurnTime", 125);
      source.emit("dv.stages", [
        {
          stage: 1,
          stageMass: 8,
          dryMass: 2,
          fuelMass: 6,
          startMass: 8,
          endMass: 2,
          burnTime: 60,
          deltaVVac: 2000,
          deltaVASL: 1800,
          deltaVActual: 1900,
          TWRVac: 1.4,
          TWRASL: 1.2,
          TWRActual: 1.3,
          ispVac: 320,
          ispASL: 270,
          ispActual: 280,
          thrustVac: 400,
          thrustASL: 340,
          thrustActual: 360,
        },
        {
          stage: 0,
          stageMass: 2,
          dryMass: 2,
          fuelMass: 0,
          startMass: 2,
          endMass: 2,
          burnTime: 0,
          // Telemachus emitted these as null during a mid-staging frame.
          // Cast to `unknown as number` so the test mirrors the real
          // runtime payload while satisfying the TS shape.
          deltaVVac: null as unknown as number,
          deltaVASL: null as unknown as number,
          deltaVActual: null as unknown as number,
          TWRVac: null as unknown as number,
          TWRASL: null as unknown as number,
          TWRActual: null as unknown as number,
          ispVac: 0,
          ispASL: 0,
          ispActual: 0,
          thrustVac: 0,
          thrustASL: 0,
          thrustActual: 0,
        },
      ]);
    });

    // No error boundary fallback — the panel rendered.
    expect(container.textContent).toContain("FUEL · ΔV");
    // The non-numeric stage falls back to "—" rather than crashing.
    expect(queryAllByText("— m/s").length).toBeGreaterThan(0);
    expect(queryAllByText(/TWR\s+—/).length).toBeGreaterThan(0);
  });

  it("displays totals and per-stage ΔV for the selected reference mode", () => {
    const { queryByText, container } = render(
      <FuelStatusComponent config={{ deltaVMode: "vac" }} id="fuel-test" />,
    );

    act(() => {
      primeFlight();
      source.emit("v.currentStage", 1);
      source.emit("dv.stageCount", 2);
      source.emit("dv.totalDVVac", 4200);
      source.emit("dv.totalDVASL", 3800);
      source.emit("dv.totalDVActual", 3900);
      source.emit("dv.totalBurnTime", 125);
      source.emit("dv.stages", [
        {
          ...makeStage(1, 4400),
          deltaVVac: 2500,
          deltaVASL: 2100,
          deltaVActual: 2300,
          TWRVac: 1.45,
          TWRASL: 1.2,
          TWRActual: 1.3,
          burnTime: 72,
        },
        {
          ...makeStage(0, 1200),
          deltaVVac: 1700,
          deltaVASL: 1500,
          deltaVActual: 1600,
          TWRVac: 1.9,
          TWRASL: 1.6,
          TWRActual: 1.75,
          burnTime: 53,
        },
      ]);
    });

    // Totals row reports vacuum ΔV (mode="vac") and total burn duration.
    expect(queryByText("4200 m/s")).not.toBeNull();
    expect(queryByText("VAC")).not.toBeNull();
    expect(queryByText("2m 5s")).not.toBeNull();

    // Per-stage ΔV picks the vacuum column.
    const stageValueTexts = Array.from(container.querySelectorAll("span")).map(
      (el) => el.textContent ?? "",
    );
    expect(stageValueTexts).toContain("2500 m/s");
    expect(stageValueTexts).toContain("1700 m/s");
  });

  // Augment slots (Uplink architecture §4) — the widget exposes
  // `fuel-status.badges` (header) and `fuel-status.sections` (body). With no
  // augment registered the slots render nothing and the widget is unchanged;
  // once an augment binds a slot, its component appears in the widget's space.
  it("renders with empty augment slots when nothing is registered", () => {
    const { container } = render(
      <FuelStatusComponent config={{}} id="fuel-test" />,
    );

    act(() => {
      primeFlight();
    });

    // Panel still renders; no augment content leaks in.
    expect(container.textContent).toContain("FUEL · ΔV");
    expect(container.textContent).not.toContain("BOIL-OFF");
    expect(container.textContent).not.toContain("RELIABILITY OK");
  });

  it("renders augments bound to the badges and sections slots", () => {
    registerAugment({
      id: "test-fuel-badge",
      augments: "fuel-status.badges",
      component: () => <span>RELIABILITY OK</span>,
    });
    registerAugment({
      id: "test-fuel-section",
      augments: "fuel-status.sections",
      component: () => <div>BOIL-OFF 0.02/s</div>,
    });

    const { container } = render(
      <FuelStatusComponent config={{}} id="fuel-test" />,
    );

    act(() => {
      primeFlight();
    });

    expect(container.textContent).toContain("RELIABILITY OK");
    expect(container.textContent).toContain("BOIL-OFF 0.02/s");
  });
});
