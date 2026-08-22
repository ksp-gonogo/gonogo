import type { DataKey } from "@ksp-gonogo/core";
import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { useWidgetScope } from "@ksp-gonogo/ui-kit";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler / augment registries: clearActionHandlers()/clearAugments()
// firing on a still-mounted widget is a state update outside act(). RTL
// auto-cleanup runs after this file's afterEach, too late to unmount first.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

/**
 * PowerSystems augment-slot exposure (this widget
 * is THE worked example). The `power-systems.sections` slot is exposed but
 * ships no filler here (that is an Uplink augment's job): an empty slot must
 * render cleanly, and a test augment registered into it must appear, reading
 * the widget's resource focus from its published scope.
 */

const KEYS: DataKey[] = [
  { key: "r.resource[ElectricCharge]" },
  { key: "parts.power" },
];

const VESSEL_PARTS_WIRE = {
  parts: [
    {
      id: "1",
      name: "probeCore",
      title: "Probe Core",
      position: { x: 0, y: 0, z: 0 },
      bounds: { size: { x: 1, y: 1, z: 1 } },
      dryMass: 0.1,
      inverseStage: 0,
      maxTemp: 1200,
      category: "Pods",
      modules: [],
      isRobotics: false,
      isPowerRelated: false,
      resources: {
        ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
      },
      moduleStates: [],
    },
  ],
};

// Drive the widget to its full-list layout (topology present + a live EC flow),
// where the `sections` body slot renders.
// Everything (topology AND per-part resources) streams off the single
// `vessel.parts` payload now (`useTopology`/`usePartsLive` both read it
// canonically); the legacy AUX source only still carries the vessel-wide
// sparkline reservoir key and `parts.power`'s measured-total reading,
// neither of which is part of this per-part live-data migration.
async function renderFullList() {
  const streamFixture = setupStreamFixture({
    carriedChannels: ["vessel.parts"],
    pinnedUt: 10,
  });
  const legacyAux = await setupMockDataSource({
    id: "data",
    keys: KEYS,
    connectSource: true,
  });
  render(
    <streamFixture.Provider>
      {/* The identity the dashboard supplies: `Panel` completes
          `${componentId}.${segment}` from it for the universal
          `sections` and `actions` seams. */}
      <WidgetMetaContext.Provider
        value={{ componentId: "power-systems", contributionSlots: [] }}
      >
        <DashboardItemContext.Provider value={{ instanceId: "ps-slot" }}>
          <PowerSystemsComponent id="ps-slot" w={8} h={12} />
        </DashboardItemContext.Provider>
      </WidgetMetaContext.Provider>
    </streamFixture.Provider>,
  );
  act(() => {
    streamFixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
  });
  await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
  return legacyAux;
}

describe("PowerSystems: augment slots (spec §4)", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes its slot on the component definition", () => {
    // The registry entry is asserted indirectly: the widget's own module-load
    // registration declared the slot as its extension point.
    // (See registerComponent `augmentSlots` in ./index.tsx.)
    expect(getAugmentsForSlot("power-systems.sections")).toEqual([]);
  });

  it("renders the full list with no augment bound (an empty slot is inert)", async () => {
    const fixture = await renderFullList();
    // An empty slot adds nothing: the stock readout renders exactly as before.
    expect(screen.getByText("Producers")).toBeTruthy();
    expect(screen.getByText("Consumers")).toBeTruthy();
    expect(screen.queryByTestId("ps-section-augment")).toBeNull();
    teardownMockDataSource(fixture);
  });

  it("renders a test augment bound to the sections slot, which reads the focused resource from the widget's scope", async () => {
    // `power-systems.sections` is the framework's universal segment now and
    // carries no props; the resource the operator is looking at reaches the
    // augment through the widget's published SCOPE instead.
    function SectionAugment() {
      const resource = useWidgetScope("power-systems")?.resource;
      return <div data-testid="ps-section-augment">EC-BROKER: {resource}</div>;
    }
    const fixture = await renderFullList();

    act(() => {
      registerAugment({
        id: "test-ps-section",
        augments: "power-systems.sections",
        component: SectionAugment,
      });
    });

    const augment = await screen.findByTestId("ps-section-augment");
    expect(augment).toBeTruthy();
    // The widget published its current resource focus, and the augment read it.
    expect(augment.textContent).toBe("EC-BROKER: ElectricCharge");
    teardownMockDataSource(fixture);
  });
});
