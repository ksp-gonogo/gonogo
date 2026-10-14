import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  dvCurrentStageResourceChannel,
  dvCurrentStageResourceMaxChannel,
} from "@ksp-gonogo/sitrep-client";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

/**
 * FuelStatus off the real stream pipeline. The `dv.stages` rows here carry the wire's own `StageDeltaVEntry` names, and the stage-scoped resource channels are registered on the fixture store because a `providedStore` does not register the production derived channels.
 */

// Tracked so afterEach unmounts them before clearing the augment registry; clearing under a mounted AugmentSlot is an update outside act().
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearAugments();
});

function makeFixture() {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  fixture.store.registerDerivedChannel(dvCurrentStageResourceChannel);
  fixture.store.registerDerivedChannel(dvCurrentStageResourceMaxChannel);
  return fixture;
}

function renderFuel(
  fixture: ReturnType<typeof setupStreamFixture>,
  config: Record<string, unknown> = {},
) {
  return render(
    <fixture.Provider>
      {/* `Panel` completes `${componentId}.${segment}` from this identity for the `sections` and `actions` seams. */}
      <WidgetMetaContext.Provider
        value={{ componentId: "fuel-status", contributionSlots: [] }}
      >
        <DashboardItemContext.Provider value={{ instanceId: "fuel-test" }}>
          <FuelStatusComponent config={config} id="fuel-test" />
        </DashboardItemContext.Provider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
}

/** A `dv.stages` entry carrying the per-stage resource breakdown that the `dv.currentStageResource(Max)` derivation reads. */
function stageWithResources(
  stage: number,
  resources: Record<string, { current: number; max: number }>,
): Record<string, unknown> {
  return { stage, resources };
}

function makeStage(stage: number, fuelMass: number): Record<string, number> {
  return {
    stage,
    fuelMass,
    dryMass: 0,
    startMass: fuelMass,
    endMass: 0,
    burnTime: 0,
    dvVac: 0,
    dvAsl: 0,
    dvActual: 0,
    twrVac: 0,
    twrAsl: 0,
    twrActual: 0,
    thrustVac: 0,
    thrustAsl: 0,
    thrustActual: 0,
  };
}

describe("FuelStatusComponent", () => {
  it("renders a meter for each resource with a non-zero max", async () => {
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 0 });
      // LiquidFuel and Oxidizer are stage-scoped, carried on the active stage's slice of dv.stages; RCS and friends stay absent.
      fixture.emit("dv.stages", [
        stageWithResources(0, {
          LiquidFuel: { current: 600, max: 1200 },
          Oxidizer: { current: 1000, max: 1467 },
        }),
      ]);
    });

    // 600/1200 on LF is a half-full meter.
    const lf = await screen.findByRole("meter", {
      name: "Liquid Fuel · stage",
    });
    expect(lf).toHaveAttribute("aria-valuenow", "50");
    expect(
      screen.getByRole("meter", { name: "Oxidizer · stage" }),
    ).toBeInTheDocument();
    // RCS, Xenon and Power are not reported at all, so their rows are hidden.
    expect(screen.queryByRole("meter", { name: /^RCS/ })).toBeNull();
    expect(screen.queryByRole("meter", { name: /^Xenon/ })).toBeNull();
    expect(screen.queryByRole("meter", { name: /^Power/ })).toBeNull();
  });

  it("holds each resource meter marked held once the link stops, rather than dropping the row", async () => {
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 0 });
      fixture.emit("vessel.resources", {
        resources: { MonoPropellant: { current: 60, max: 120 } },
      });
      fixture.emit("dv.stages", [
        stageWithResources(0, { LiquidFuel: { current: 600, max: 1200 } }),
      ]);
    });
    const live = await screen.findByRole("meter", { name: "RCS · vessel" });
    expect(live.querySelector("[data-fill-held]")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    for (const name of ["RCS · vessel", "Liquid Fuel · stage"]) {
      const held = screen.getByRole("meter", { name });
      expect(held).toHaveAttribute("aria-valuenow", "50");
      expect(held.querySelector("[data-fill-held]")).not.toBeNull();
    }
    await act(async () => {});
  });

  it("holds the stage ΔV meters marked held with the budget they are rows of", async () => {
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 1 });
      fixture.emit("dv.summary", { stageCount: 2, totalDvActual: 3000 });
      fixture.emit("dv.stages", [
        { ...makeStage(1, 4400), dvActual: 2000 },
        { ...makeStage(0, 1200), dvActual: 1000 },
      ]);
    });
    const live = await screen.findByRole("meter", { name: "S0" });
    expect(live).toHaveAttribute("aria-valuenow", "50");
    expect(live.querySelector("[data-fill-held]")).toBeNull();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    for (const name of ["▶ S1", "S0"]) {
      const held = screen.getByRole("meter", { name });
      expect(held.querySelector("[data-fill-held]")).not.toBeNull();
    }
    expect(screen.getByRole("meter", { name: "S0" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    await act(async () => {});
  });

  it("shows RCS (vessel-wide) whenever monoprop max > 0, even with empty stage slot", async () => {
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      // Stage has no monoprop, but the vessel carries a full RCS tank up top.
      fixture.emit("vessel.resources", {
        resources: { MonoPropellant: { current: 120, max: 120 } },
      });
    });

    expect(
      await screen.findByRole("meter", { name: "RCS · vessel" }),
    ).toBeInTheDocument();
  });

  it("renders the stage stack with the current stage highlighted", async () => {
    const fixture = makeFixture();
    renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 1 });
      fixture.emit("dv.summary", { stageCount: 3 });
      fixture.emit("dv.stages", [
        makeStage(2, 8000),
        makeStage(1, 4400),
        makeStage(0, 1200),
      ]);
    });

    await waitFor(() => {
      const stages = screen
        .queryAllByRole("meter")
        .map((el) => el.getAttribute("aria-label"))
        .filter((name) => name !== null && /S\d$/.test(name));
      expect(stages).toEqual(["S2", "▶ S1", "S0"]);
    });
  });

  it("survives a stage row with non-numeric TWR / ΔV", async () => {
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 1 });
      fixture.emit("dv.summary", {
        stageCount: 2,
        totalDvActual: 4200,
        totalBurnTime: 125,
      });
      fixture.emit("dv.stages", [
        {
          stage: 1,
          dryMass: 2,
          fuelMass: 6,
          startMass: 8,
          endMass: 2,
          burnTime: 60,
          dvVac: 2000,
          dvAsl: 1800,
          dvActual: 1900,
          twrVac: 1.4,
          twrAsl: 1.2,
          twrActual: 1.3,
          thrustVac: 400,
          thrustAsl: 340,
          thrustActual: 360,
        },
        {
          stage: 0,
          dryMass: 2,
          fuelMass: 0,
          startMass: 2,
          endMass: 2,
          burnTime: 0,
          // Emitted as null during a mid-staging frame.
          dvVac: null,
          dvAsl: null,
          dvActual: null,
          twrVac: null,
          twrAsl: null,
          twrActual: null,
          thrustVac: 0,
          thrustAsl: 0,
          thrustActual: 0,
        },
      ]);
    });

    // Wait for the stage stack: the panel title alone renders before any data.
    await waitFor(() =>
      expect(
        screen.queryAllByText(new RegExp(`TWR\\s+${NULL_DISPLAY}`)).length,
      ).toBeGreaterThan(0),
    );
    expect(visibleText(container)).toContain("FUEL · ΔV");
    // A bare placeholder: `<Unit>` draws no symbol beside an absent value, since a null followed by "m/s" claims a reading that was never taken.
    expect(screen.queryAllByText(NULL_DISPLAY).length).toBeGreaterThan(0);
  });

  it("displays totals and per-stage ΔV for the selected reference mode", async () => {
    const fixture = makeFixture();
    const { container } = renderFuel(fixture, { deltaVMode: "vac" });

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 1 });
      fixture.emit("dv.summary", {
        stageCount: 2,
        totalDvVac: 4200,
        totalDvAsl: 3800,
        totalDvActual: 3900,
        totalBurnTime: 125,
      });
      fixture.emit("dv.stages", [
        {
          ...makeStage(1, 4400),
          dvVac: 2500,
          dvAsl: 2100,
          dvActual: 2300,
          twrVac: 1.45,
          twrAsl: 1.2,
          twrActual: 1.3,
          burnTime: 72,
        },
        {
          ...makeStage(0, 1200),
          dvVac: 1700,
          dvAsl: 1500,
          dvActual: 1600,
          twrVac: 1.9,
          twrAsl: 1.6,
          twrActual: 1.75,
          burnTime: 53,
        },
      ]);
    });

    // Totals row reports vacuum ΔV (mode="vac") and total burn duration.
    await waitFor(() => expect(visibleText()).toContain("4200 m/s"));
    expect(screen.queryByText("VAC")).not.toBeNull();
    expect(screen.queryByText("2min 5s")).not.toBeNull();

    // `visibleText`, not `.textContent`: a readout carries a hidden word for screen readers.
    const stageValueTexts = Array.from(container.querySelectorAll("span")).map(
      (el) => visibleText(el),
    );
    expect(stageValueTexts).toContain("2500 m/s");
    expect(stageValueTexts).toContain("1700 m/s");
  });

  // With no augment registered the `fuel-status.sections` slot renders nothing.
  it("renders with an empty augment slot when nothing is registered", async () => {
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    await waitFor(() => expect(visibleText(container)).toContain("FUEL · ΔV"));
    expect(container.textContent).not.toContain("BOIL-OFF");
  });

  it("renders an augment bound to the sections slot", async () => {
    registerAugment({
      id: "test-fuel-section",
      augments: "fuel-status.sections",
      component: () => <div>BOIL-OFF 0.02/s</div>,
    });

    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    await waitFor(() =>
      expect(visibleText(container)).toContain("BOIL-OFF 0.02/s"),
    );
  });
});
