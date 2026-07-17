import type { DataKey } from "@ksp-gonogo/core";
import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { PowerSystemsComponent, type PowerSystemsSlotContext } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// action-handler / augment registries — clearActionHandlers()/clearAugments()
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
 * is THE worked example). The slots (`power-systems.sections`,
 * `power-systems.badges`) are exposed but ship no filler here (that's an Uplink
 * augment's job): an empty slot must render cleanly, and a test augment
 * registered into it must appear, receiving the widget's resource focus as
 * typed slot props.
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
// where both the `badges` header slot and the `sections` body slot render.
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
      <DashboardItemContext.Provider value={{ instanceId: "ps-slot" }}>
        <PowerSystemsComponent id="ps-slot" w={8} h={12} />
      </DashboardItemContext.Provider>
    </streamFixture.Provider>,
  );
  act(() => {
    streamFixture.emit("vessel.parts", VESSEL_PARTS_WIRE);
  });
  await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
  return legacyAux;
}

describe("PowerSystems — augment slots (spec §4)", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearActionHandlers();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes both slots on its component definition", () => {
    // The registry entry is asserted indirectly: the widget's own module-load
    // registration declared the two slots as its extension points.
    // (See registerComponent `augmentSlots` in ./index.tsx.)
    expect(getAugmentsForSlot("power-systems.sections")).toEqual([]);
    expect(getAugmentsForSlot("power-systems.badges")).toEqual([]);
  });

  it("renders the full list with no augments bound (empty slots are inert)", async () => {
    const fixture = await renderFullList();
    // Empty slots add nothing — the stock readout renders exactly as before.
    expect(screen.getByText("Producers")).toBeTruthy();
    expect(screen.getByText("Consumers")).toBeTruthy();
    expect(screen.queryByTestId("ps-section-augment")).toBeNull();
    expect(screen.queryByTestId("ps-badge-augment")).toBeNull();
    teardownMockDataSource(fixture);
  });

  it("renders a test augment bound to the sections slot, passing the focused resource as slot props", async () => {
    function SectionAugment({ resource }: PowerSystemsSlotContext) {
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
    // The slot passed the widget's current resource focus down.
    expect(augment.textContent).toBe("EC-BROKER: ElectricCharge");
    teardownMockDataSource(fixture);
  });

  it("renders a test augment bound to the badges slot in the header", async () => {
    function BadgeAugment({ resource }: PowerSystemsSlotContext) {
      return <span data-testid="ps-badge-augment">{resource}!</span>;
    }
    const fixture = await renderFullList();

    act(() => {
      registerAugment({
        id: "test-ps-badge",
        augments: "power-systems.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("ps-badge-augment");
    expect(badge.textContent).toBe("ElectricCharge!");
    teardownMockDataSource(fixture);
  });
});
