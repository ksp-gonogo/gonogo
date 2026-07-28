/**
 * Uplink Client Contract (Phase 1, design doc §3.1/§3.3): a widget
 * registered through a `defineUplinkClient` handle carries its owner's id
 * as a search tag automatically: `effectiveSearchTags` derives it from
 * `def.owner?.id`, never a hand-set per-widget field. This exercises the
 * real registry + the real ComponentOverlay, searching by the owner's id,
 * same "mock as little as possible" shape as component-overlay-add.test.tsx.
 *
 * Fictional owner token ("mod-alpha"): a real first-party Uplink token only
 * ever appears inside its own Uplink client dir (uplink-boundary ratchet);
 * the mod-search-tags reference branch made the same choice for its own
 * core/app-level tests.
 */

import {
  clearRegistry,
  defineUplinkClient,
  registerComponent,
} from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComponentOverlay,
  OverlayProvider,
} from "../components/ComponentOverlay";

const MOD_ALPHA = defineUplinkClient({
  id: "mod-alpha",
  version: "0.0.0-dev",
  name: "Mod Alpha",
});

function OwnedWidget() {
  return <div>owned widget</div>;
}

// No CpuRegistryProvider wrap needed here (unlike
// component-overlay-add.test.tsx): this suite imports no Uplink client
// package, so nothing registers a chrome provider, and neither widget under
// test opens a config modal, so ComponentOverlay's useChromeWrap() has an
// empty registered-provider list to iterate: nothing to supply.
function renderOverlay() {
  const serialService = new SerialDeviceService({ screenKey: "test" });
  return render(
    <ModalProvider>
      <SerialDeviceProvider service={serialService}>
        <OverlayProvider addItem={() => {}} updateItemConfig={() => {}}>
          <ComponentOverlay currentLayouts={{ lg: [] }} />
        </OverlayProvider>
      </SerialDeviceProvider>
    </ModalProvider>,
  );
}

describe("ComponentOverlay: owner-derived mod search tags", () => {
  afterEach(() => {
    clearRegistry();
  });

  it("surfaces an owner-stamped widget when searching by the owner's id", async () => {
    registerComponent({
      id: "owned-widget",
      name: "Owned Widget",
      description: "A widget registered through an Uplink client handle.",
      tags: ["telemetry"],
      component: OwnedWidget,
      owner: MOD_ALPHA,
    });

    const user = userEvent.setup();
    renderOverlay();

    await user.click(screen.getByRole("button", { name: "Add component" }));
    // Nothing matches "mod-alpha" as a literal tag on the def, only via
    // effectiveSearchTags deriving it from `owner.id`.
    await user.type(
      screen.getByRole("combobox", { name: "Search widgets" }),
      "mod-alpha",
    );

    expect(
      await screen.findByRole("option", { name: /Owned Widget/ }),
    ).toBeInTheDocument();
  });

  it("does not surface an unowned widget when searching by an owner id", async () => {
    registerComponent({
      id: "unowned-widget",
      name: "Unowned Widget",
      description: "A widget with no Uplink owner.",
      tags: ["telemetry"],
      component: OwnedWidget,
    });

    const user = userEvent.setup();
    renderOverlay();

    await user.click(screen.getByRole("button", { name: "Add component" }));
    await user.type(
      screen.getByRole("combobox", { name: "Search widgets" }),
      "mod-alpha",
    );

    expect(
      screen.queryByRole("option", { name: /Unowned Widget/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/No widgets match/)).toBeInTheDocument();
  });
});
