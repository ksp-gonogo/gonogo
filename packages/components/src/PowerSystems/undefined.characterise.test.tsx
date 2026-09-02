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
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

/**
 * What `undefined` MEANS to PowerSystems today, recorded before `useTelemetry`
 * starts returning a `Reading`.
 *
 * Three separate absences drive this widget and they mean three different
 * things:
 *
 * - `vessel.parts` absent (via `useTopology`, which returns `undefined` for
 *   both a missing and a tombstoned payload) is read as "waiting", and it is
 *   the only case that suppresses the whole body
 * - `parts.power` absent is read as "no second opinion", and is silently
 *   indistinguishable from a measurement that AGREES with the itemized rows
 * - a per-part `flow` absent is read as "idle", and is coerced to a rendered
 *   `0.00` rather than a placeholder
 *
 * All three are `useTelemetry` reads (`parts.power` directly, the other two
 * through the `vessel.parts` hooks), so all three are load-bearing for the
 * migration.
 */
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

const auxSources: MockDataSourceFixture[] = [];

// `useDataSeries("data", ...)` backs the sparkline, so the legacy aux source has
// to exist for the same reason the sibling stream tests stand it up.
async function legacyAux(): Promise<void> {
  auxSources.push(
    await setupMockDataSource({ id: "data", keys: [], connectSource: true }),
  );
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
  for (const aux of auxSources) teardownMockDataSource(aux);
  auxSources.length = 0;
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
    await legacyAux();
    const fixture = newFixture();
    renderPower(fixture, "ps-nothing");
    // The sparkline's `useDataSeries` backfill query resolves on a later
    // microtask. Every other test here awaits a `waitFor` that carries it; this
    // one asserts on the empty state and awaits nothing, so it settles the
    // backfill itself rather than letting the update land in teardown.
    await act(async () => {});

    // `if (!topology)` is the widest gate in the widget: it returns early, so
    // none of the board exists. Named absences, because a widget that renders
    // nothing satisfies almost any assertion.
    expect(screen.getByText("Waiting for vessel topology...")).toBeTruthy();
    expect(screen.getByText("POWER SYSTEMS")).toBeTruthy();
    expect(screen.queryByText("NET")).toBeNull();
    expect(screen.queryByText("PROD")).toBeNull();
    expect(screen.queryByText("CONS")).toBeNull();
    expect(screen.queryByText("Producers")).toBeNull();
    // The resource picker is part of the suppressed board, so the operator
    // cannot even change resource while the topology is missing.
    expect(screen.queryByRole("combobox", { name: "Resource" })).toBeNull();
  });

  it("falls back to the same waiting hint when the topology is tombstoned", async () => {
    // `useTopology` gates on `wire ? ... : undefined`, so a CONFIRMED "this
    // vessel has no parts" and "nothing has streamed yet" render the same
    // sentence. The real payload goes first so the tombstone is proven to have
    // landed rather than being silently dropped.
    await legacyAux();
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
    // A part can carry storage and no `flow` at all. `typeof row.flow ===
    // "number"` is the gate, so an absent flow does not count as a resource
    // with flow, and the second early return fires: a vessel with a full
    // battery and no flow readings reads as "no active flow".
    await legacyAux();
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
    // Storage exists and is still not shown: the STORED cell lives on the
    // suppressed board.
    expect(screen.queryByText("STORED")).toBeNull();
    expect(screen.queryByText("NET")).toBeNull();
  });

  it("shows no MEASURED cell at all while parts.power has never arrived", async () => {
    // `magnitudeOf(streamPower?.totalProductionEc) ?? undefined` makes the
    // absent measurement indistinguishable from one that AGREES: both render
    // exactly the itemized total and nothing else. The dashed MEASURED cell is
    // the widget's only signal that a second opinion exists at all.
    await legacyAux();
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
    // Partial payload, distinct from the record being absent: the channel is
    // live and carrying four empty lists, and the one field the widget reads is
    // missing. It renders identically to the never-arrived case above.
    await legacyAux();
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

  /**
   * Recorded prior behaviour: "coerces an absent per-part flow to a rendered 0.00
   * in the Idle section". `flow: row.flow ?? 0` listed a part with a nominal
   * capacity and no flow reading as idle at exactly zero, identical to a
   * genuinely-shadowed panel reporting `flow: 0`, and then printed an efficiency
   * computed from the coerced value so it read as measured-at-0%.
   *
   * The two are now distinguishable: an unmeasured row is dashed and carries no
   * percentage. It still contributes nothing to PROD/NET, which is unavoidable
   * without inventing a number, but the row no longer claims the zero is a
   * measurement.
   */
  it("dashes an absent per-part flow in the Idle section rather than rendering it as 0.00", async () => {
    await legacyAux();
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
    // Once, not twice: the CONS totals cell (nothing consuming, a real zero).
    // The idle row is dashed, and says why on hover.
    expect(screen.getAllByText("0.00")).toHaveLength(1);
    expect(screen.getByTitle("No flow reading for this part")).toBeTruthy();
    // And no efficiency, because there is no measurement to take a fraction of.
    expect(screen.queryByTitle(/of nominal/)).toBeNull();
    // The idle row contributes nothing to the totals, so NET still reads the
    // one real producer.
    expect(visibleText()).toContain("+5.00/s");
  });
});
