import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
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
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FuelStatusComponent } from "./index";

/**
 * FuelStatus runs genuinely off the real `TelemetryProvider`/`TelemetryClient`/
 * `TimelineStore` pipeline via `StubTransport` — every read is canonical
 * (`useTelemetry`/`useStream`), with no legacy `DataSource` anywhere:
 * - `v.currentStage` -> `vessel.structure.currentStage`
 * - `dv.stageCount`/`dv.totalDV*`/`dv.totalBurnTime` -> `dv.summary.*`
 * - `dv.stages` -> the whole `dv.stages` topic (new `StageDeltaVEntry` shape;
 *   `parseStages` reconciles it with the legacy `StageInfo` field names, so
 *   these fixtures keep emitting the legacy names as a shape-tolerance proof)
 * - vessel-total resources (RCS/Xe/Power) -> `vessel.resources`
 * - stage-scoped resources (LiquidFuel/Oxidizer) -> the derived
 *   `dv.currentStageResource`/`dv.currentStageResourceMax` channels
 *   (`dv-stage-resources.ts`), registered on the fixture store below since a
 *   `providedStore` doesn't auto-register the production derived channels.
 */

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// augment registry — clearAugments() firing on a still-mounted AugmentSlot is
// a state update outside act() (CLAUDE.md → Testing Philosophy).
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

const CARRIED = [
  "vessel.structure",
  "vessel.resources",
  "dv.stages",
  "dv.summary",
];

function makeFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  // A providedStore doesn't inherit the production derived-channel set, so the
  // stage-scoped resource channels this widget reads must be registered here.
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
      <DashboardItemContext.Provider value={{ instanceId: "fuel-test" }}>
        <FuelStatusComponent config={config} id="fuel-test" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

/** A `dv.stages` entry carrying a per-stage resource breakdown — the shape the
 * `dv.currentStageResource(Max)` derivation reads. */
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
  it("renders a bar for each resource with a non-zero max", async () => {
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    act(() => {
      fixture.emit("vessel.structure", { currentStage: 0 });
      // LiquidFuel + Oxidizer are stage-scoped — carried on the active stage's
      // slice of dv.stages. RCS and friends stay absent (no vessel.resources).
      fixture.emit("dv.stages", [
        stageWithResources(0, {
          LiquidFuel: { current: 600, max: 1200 },
          Oxidizer: { current: 1000, max: 1467 },
        }),
      ]);
    });

    await waitFor(() =>
      expect(screen.getByText("Liquid Fuel")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Oxidizer")).not.toBeNull();
    // RCS / Xenon / Power all have max=0 → rows hidden.
    expect(screen.queryByText("RCS")).toBeNull();
    expect(screen.queryByText("Xenon")).toBeNull();
    expect(screen.queryByText("Power")).toBeNull();

    // 600/1200 on LF → 50% fill (width: 50%).
    const fills = Array.from(
      container.querySelectorAll("div[style*='width']"),
    ).map((el) => (el as HTMLElement).style.width);
    expect(fills).toContain("50%");
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

    await waitFor(() => expect(screen.getByText("RCS")).toBeInTheDocument());
  });

  it("renders the stage stack with the current stage highlighted", async () => {
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

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
      const stageTexts = Array.from(container.querySelectorAll("span"))
        .map((el) => el.textContent ?? "")
        .filter((t) => /^[▶ ] S\d$/.test(t));
      expect(stageTexts).toEqual(["  S2", "▶ S1", "  S0"]);
    });
  });

  // Regression: at 21:08 BST on 2026-05-17 the widget crashed with
  // `twr.toFixed is not a function` on a stage row whose TWR/ΔV fields were
  // null instead of numbers. The crash took the whole widget down.
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
          // Emitted as null during a mid-staging frame.
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

    // No error boundary fallback — the panel rendered. The non-numeric stage
    // falls back to "—" rather than crashing (wait for the stage stack to land
    // off the stream, since the panel title alone renders before any data).
    await waitFor(() =>
      expect(screen.queryAllByText("— m/s").length).toBeGreaterThan(0),
    );
    expect(container.textContent).toContain("FUEL · ΔV");
    expect(screen.queryAllByText(/TWR\s+—/).length).toBeGreaterThan(0);
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
    await waitFor(() =>
      expect(screen.getByText("4200 m/s")).toBeInTheDocument(),
    );
    expect(screen.queryByText("VAC")).not.toBeNull();
    expect(screen.queryByText("2m 5s")).not.toBeNull();

    // Per-stage ΔV picks the vacuum column.
    const stageValueTexts = Array.from(container.querySelectorAll("span")).map(
      (el) => el.textContent ?? "",
    );
    expect(stageValueTexts).toContain("2500 m/s");
    expect(stageValueTexts).toContain("1700 m/s");
  });

  // Augment slots (Uplink architecture §4) — the widget exposes
  // `fuel-status.badges` (header) and `fuel-status.sections` (body). With no
  // augment registered the slots render nothing and the widget is unchanged.
  it("renders with empty augment slots when nothing is registered", async () => {
    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    await waitFor(() => expect(container.textContent).toContain("FUEL · ΔV"));
    expect(container.textContent).not.toContain("BOIL-OFF");
    expect(container.textContent).not.toContain("RELIABILITY OK");
  });

  it("renders augments bound to the badges and sections slots", async () => {
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

    const fixture = makeFixture();
    const { container } = renderFuel(fixture);

    await waitFor(() =>
      expect(container.textContent).toContain("RELIABILITY OK"),
    );
    expect(container.textContent).toContain("BOIL-OFF 0.02/s");
  });
});
