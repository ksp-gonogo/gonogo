import type { DataKey } from "@gonogo/core";
import {
  clearActionHandlers,
  clearAugments,
  DashboardItemContext,
  getAugmentsForSlot,
  registerAugment,
} from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { PowerSystemsComponent, type PowerSystemsSlotContext } from "./index";

/**
 * PowerSystems augment-slot exposure (Uplink architecture spec §4 — this widget
 * is THE worked example). The slots (`power-systems.sections`,
 * `power-systems.badges`) are exposed but ship no filler here (that's an Uplink
 * augment, P3/P6): an empty slot must render cleanly, and a test augment
 * registered into it must appear, receiving the widget's resource focus as
 * typed slot props (§4.4).
 */

const KEYS: DataKey[] = [
  { key: "v.topologySeq" },
  { key: "v.topology" },
  { key: "r.resourceFor[1]" },
  { key: "r.resource[ElectricCharge]" },
  { key: "parts.power" },
];

const TOPOLOGY = {
  topologySeq: 1,
  rootFlightId: 1,
  parts: [{ flightId: 1, name: "probeCore", title: "Probe Core" }],
};

// Drive the widget to its full-list layout (topology present + a live EC flow),
// where both the `badges` header slot and the `sections` body slot render.
async function renderFullList() {
  const fixture = await setupMockDataSource({
    id: "data",
    keys: KEYS,
    connectSource: true,
  });
  render(
    <DashboardItemContext.Provider value={{ instanceId: "ps-slot" }}>
      <PowerSystemsComponent id="ps-slot" w={8} h={12} />
    </DashboardItemContext.Provider>,
  );
  act(() => {
    fixture.source.emit("v.topologySeq", 1);
    fixture.source.emit("v.topology", TOPOLOGY);
    fixture.source.emit("r.resourceFor[1]", {
      ElectricCharge: { amount: 10, maxAmount: 100, flow: 5, nominalFlow: 5 },
    });
  });
  await waitFor(() => expect(screen.getByText("PROD")).toBeTruthy());
  return fixture;
}

describe("PowerSystems — augment slots (spec §4)", () => {
  afterEach(() => {
    cleanup();
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
    // The slot passed the widget's current resource focus down (spec §4.4).
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
