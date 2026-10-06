/**
 * Adding a widget whose ComponentDefinition has `openConfigOnAdd: true` opens
 * the config modal immediately. This test covers the config-persists-on-
 * initial-add path.
 */

import {
  type ComponentDefinition,
  clearRegistry,
  registerComponent,
} from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { clearAugments, registerAugment } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComponentOverlay,
  OverlayProvider,
} from "../components/ComponentOverlay";

interface TrivialConfig {
  label?: string;
}

function TrivialWidget({ config }: { config?: TrivialConfig }) {
  return <div>trivial: {config?.label ?? "default"}</div>;
}

function TrivialConfigUI({
  config,
  onSave,
}: {
  config: TrivialConfig;
  onSave: (next: TrivialConfig) => void;
}) {
  return (
    <div>
      <input
        aria-label="label"
        defaultValue={config.label ?? ""}
        onChange={(e) => {
          // store draft on DOM attribute for the save button to pick up
          e.currentTarget.dataset.draft = e.currentTarget.value;
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          const input = (e.currentTarget.previousElementSibling ??
            null) as HTMLInputElement | null;
          onSave({ label: input?.value ?? "" });
        }}
      >
        Save
      </button>
    </div>
  );
}

function registerTrivial() {
  registerComponent({
    id: "trivial",
    name: "Trivial",
    description: "",
    tags: [],
    component: TrivialWidget,
    configComponent: TrivialConfigUI,
    openConfigOnAdd: true,
    dataRequirements: [],
    behaviors: [],
    defaultConfig: { label: "default" },
  } as unknown as ComponentDefinition);
}

describe("ComponentOverlay: add → configure → persist", () => {
  afterEach(() => {
    clearRegistry();
    clearAugments();
  });

  it("persists the config entered in the on-add modal via updateItemConfig", async () => {
    // registerComponent before render, ComponentOverlay reads the registry on every render via getComponents().
    registerTrivial();
    const user = userEvent.setup();
    const addItem = vi.fn();
    const updateItemConfig = vi.fn();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider
            addItem={addItem}
            updateItemConfig={updateItemConfig}
          >
            <ComponentOverlay currentLayouts={{ lg: [] }} />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    // Open the component-add panel, pick Trivial. The list items are
    // listbox options whose accessible name combines name + description.
    await user.click(screen.getByRole("button", { name: "Add component" }));
    await user.click(await screen.findByRole("option", { name: /Trivial/ }));

    // addItem fired with a fresh DashboardItem. Capture its id so we can
    // assert the updateItemConfig call routes to the same instance.
    expect(addItem).toHaveBeenCalledTimes(1);
    const first: unknown = addItem.mock.calls[0][0];
    const gridId: unknown =
      typeof first === "object" && first !== null
        ? Reflect.get(first, "i")
        : undefined;
    if (typeof gridId !== "string") {
      throw new Error("addItem was not given an item with a grid id");
    }
    const newItem = { i: gridId };

    // The config modal should have opened (openConfigOnAdd). Edit + save.
    // The input has defaultValue="default", so clear before typing.
    const input = await screen.findByLabelText("label");
    await user.clear(input);
    await user.type(input, "custom-name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // This is the regression, without the fix, no call at all was made.
    expect(updateItemConfig).toHaveBeenCalledWith(newItem.i, {
      label: "custom-name",
    });
  });

  it("adds a widget by keyboard: filter, arrow, Enter (no pointer)", async () => {
    registerTrivial();
    const user = userEvent.setup();
    const addItem = vi.fn();
    const updateItemConfig = vi.fn();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider
            addItem={addItem}
            updateItemConfig={updateItemConfig}
          >
            <ComponentOverlay currentLayouts={{ lg: [] }} />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    // Open the panel: the search box autofocuses (combobox pattern), so the whole add flow is reachable from the keyboard with no pointer.
    await user.click(screen.getByRole("button", { name: "Add component" }));
    // Filter to Trivial, nudge the active option, then commit with Enter.
    await user.keyboard("Trivial");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    // Enter on the highlighted option adds the widget, same as a click would.
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it("places a widget at its defaultSize plus what the extensions that render in it ask for", async () => {
    registerComponent({
      id: "roomy",
      name: "Roomy",
      description: "",
      tags: [],
      component: TrivialWidget,
      dataRequirements: [],
      defaultSize: { w: 5, h: 6 },
      minSize: { w: 3, h: 3 },
      augmentSlots: ["roomy.sections"],
    });
    registerAugment({
      id: "roomy-extra",
      augments: "roomy.sections",
      component: () => null,
      sizeDelta: { w: 1, h: 2 },
    });
    registerAugment({
      id: "roomy-absent",
      augments: "roomy.sections",
      component: () => null,
      requires: "not-running",
      sizeDelta: { w: 4, h: 4 },
    });
    const user = userEvent.setup();
    const addItem = vi.fn();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider addItem={addItem} updateItemConfig={vi.fn()}>
            <ComponentOverlay currentLayouts={{ lg: [] }} />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add component" }));
    await user.click(await screen.findByRole("option", { name: /Roomy/ }));

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][1]).toMatchObject({ w: 6, h: 8 });
  });
});
