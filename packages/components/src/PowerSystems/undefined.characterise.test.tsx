import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

/**
 * Three absences drive PowerSystems and mean three different things:
 *
 * - `vessel.parts` absent or tombstoned reads as "waiting", the only case that suppresses the whole body
 * - `parts.power` absent reads as "no second opinion", indistinguishable from a measurement that agrees
 * - a per-part `flow` absent marks its row unmeasured, with no efficiency
 */
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

interface ResourceRow {
  amount: number;
  maxAmount: number;
  flow?: number;
  nominalFlow?: number;
}

function part(id: string, title: string, ec: ResourceRow) {
  return {
    id,
    name: title,
    title,
    position: { x: 0, y: 0, z: 0 },
    bounds: { size: { x: 1, y: 1, z: 1 } },
    dryMass: 0.1,
    inverseStage: 0,
    maxTemp: 1200,
    category: "Pods",
    modules: [],
    isRobotics: false,
    isPowerRelated: false,
    resources: { ElectricCharge: ec },
    moduleStates: [],
  };
}

function renderPower(fixture: StreamFixture, instanceId: string) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <PowerSystemsComponent id={instanceId} w={8} h={12} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["parts.power", "vessel.parts"],
    pinnedUt: 10,
    suspendFrames: true,
  });
}

describe("PowerSystems: what undefined means today", () => {
  it("renders the waiting hint and NO board when no topology has arrived", async () => {
    const fixture = newFixture();
    renderPower(fixture, "ps-nothing");
    // Settles the sparkline's backfill query, which would otherwise land in teardown.
    await act(async () => {});

    // Named absences, because a widget that renders nothing satisfies almost any assertion.
    expect(screen.getByText("Waiting for vessel topology...")).toBeTruthy();
    expect(screen.getByText("POWER SYSTEMS")).toBeTruthy();
    expect(screen.queryByText("NET")).toBeNull();
    expect(screen.queryByText("PROD")).toBeNull();
    expect(screen.queryByText("CONS")).toBeNull();
    expect(screen.queryByText("Producers")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Resource" })).toBeNull();
  });

  it("falls back to the same waiting hint when the topology is tombstoned", async () => {
    // The real payload goes first so the tombstone is proven to have landed.
    const fixture = newFixture();
    renderPower(fixture, "ps-tombstone");

    act(() => {
      fixture.emit(
        "vessel.parts",
        {
          parts: [
            part("1", "Probe Core", {
              amount: 10,
              maxAmount: 100,
              flow: 5,
            }),
          ],
        },
        { seq: 1, validAt: 9 },
      );
    });
    await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());

    act(() => {
      fixture.emit("vessel.parts", null, { seq: 2, validAt: 10 });
    });

    await waitFor(() =>
      expect(screen.getByText("Waiting for vessel topology...")).toBeTruthy(),
    );
    expect(screen.queryByText("PROD")).toBeNull();
  });

  it("renders the no-flow empty state when every part's flow field is absent", async () => {
    // An absent flow does not count as a resource with flow, so a full battery with no flow readings reads as "no active flow".
    const fixture = newFixture();
    renderPower(fixture, "ps-noflow");

    act(() => {
      fixture.emit("vessel.parts", {
        parts: [part("1", "Z-100 Battery", { amount: 100, maxAmount: 100 })],
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No active flow on any resource",
      ),
    );
    expect(
      screen.getByText(/Deploy a solar panel, run a generator/),
    ).toBeTruthy();
    expect(screen.queryByText("STORED")).toBeNull();
    expect(screen.queryByText("NET")).toBeNull();
  });

  it("shows no MEASURED cell at all while parts.power has never arrived", async () => {
    // An absent measurement renders exactly as an agreeing one: the itemised total and nothing else.
    const fixture = newFixture();
    renderPower(fixture, "ps-nopower");

    act(() => {
      fixture.emit("vessel.parts", {
        parts: [
          part("1", "Gigantor XL", { amount: 10, maxAmount: 100, flow: 5 }),
        ],
      });
    });

    await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
    expect(fixture.transport.isSubscribed("parts.power")).toBe(true);
    expect(screen.queryByText("MEASURED")).toBeNull();
    expect(visibleText()).toContain("+5.00/s");
  });

  it("shows no MEASURED cell when parts.power arrives WITHOUT totalProductionEc", async () => {
    // A live payload missing the one field read renders identically to the never-arrived case.
    const fixture = newFixture();
    renderPower(fixture, "ps-partial-power");

    act(() => {
      fixture.emit("vessel.parts", {
        parts: [
          part("1", "Gigantor XL", { amount: 10, maxAmount: 100, flow: 5 }),
        ],
      });
      fixture.emit("parts.power", {
        solarPanels: [],
        batteries: [],
        fuelCells: [],
        alternators: [],
      });
    });

    await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
    expect(screen.queryByText("MEASURED")).toBeNull();
    expect(visibleText()).toContain("+5.00/s");
  });

  // An unmeasured idle row is distinguishable from a panel measured at zero: no number, no percentage.
  it("dashes an absent per-part flow in the Idle section rather than rendering it as 0.00", async () => {
    const fixture = newFixture();
    renderPower(fixture, "ps-idle");

    act(() => {
      fixture.emit("vessel.parts", {
        parts: [
          part("1", "RTG", { amount: 0, maxAmount: 0, flow: 5 }),
          part("2", "OX-STAT Panel", {
            amount: 0,
            maxAmount: 0,
            nominalFlow: 3,
          }),
        ],
      });
    });

    await waitFor(() => expect(screen.getByText("RTG")).toBeTruthy());
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.getByText("OX-STAT Panel")).toBeTruthy();
    // Only the CONS totals cell, a real zero.
    expect(screen.getAllByText("0.00")).toHaveLength(1);
    expect(screen.getByTitle("No flow reading for this part")).toBeTruthy();
    expect(screen.queryByTitle(/of nominal/)).toBeNull();
    // The idle row contributes nothing to the totals, so NET still reads the one real producer.
    expect(visibleText()).toContain("+5.00/s");
  });
});
