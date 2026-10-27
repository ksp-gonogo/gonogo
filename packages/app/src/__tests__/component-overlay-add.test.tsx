/**
 * Adding a widget whose ComponentDefinition has `openConfigOnAdd: true` opens
 * the config modal immediately. This test covers the config-persists-on-
 * initial-add path.
 */

import { type ComponentDefinition, registerComponent } from "@ksp-gonogo/core";
import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { registerAugment } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
    defaultConfig: { label: "default" },
  } as unknown as ComponentDefinition);
}

describe("ComponentOverlay: add → configure → persist", () => {
  it("persists the config entered in the on-add modal via updateItemConfig", async () => {
    // registerComponent before render, ComponentOverlay reads the registry on every render via getComponents().
    registerTrivial();
    const user = userEvent.setup();
    const addItems = vi.fn();
    const updateItemConfig = vi.fn();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider
            addItems={addItems}
            updateItemConfig={updateItemConfig}
          >
            <ComponentOverlay />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    // Open the component-add panel, pick Trivial. The list items are
    // listbox options whose accessible name combines name + description.
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    await user.click(await screen.findByRole("option", { name: /Trivial/ }));

    // addItems fired with a fresh DashboardItem. Capture its id so we can
    // assert the updateItemConfig call routes to the same instance.
    expect(addItems).toHaveBeenCalledTimes(1);
    const first: unknown = addItems.mock.calls[0][0][0].item;
    const gridId: unknown =
      typeof first === "object" && first !== null
        ? Reflect.get(first, "i")
        : undefined;
    if (typeof gridId !== "string") {
      throw new Error("addItems was not given an item with a grid id");
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
    const addItems = vi.fn();
    const updateItemConfig = vi.fn();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider
            addItems={addItems}
            updateItemConfig={updateItemConfig}
          >
            <ComponentOverlay />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    // Open the panel: the search box autofocuses (combobox pattern), so the whole add flow is reachable from the keyboard with no pointer.
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    // Filter to Trivial, nudge the active option, then commit with Enter.
    await user.keyboard("Trivial");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    // Enter on the highlighted option adds the widget, same as a click would.
    expect(addItems).toHaveBeenCalledTimes(1);
  });

  it("adds every ticked widget in one go, by click or by Shift+Enter", async () => {
    registerTrivial();
    registerComponent({
      id: "second",
      name: "Second",
      description: "",
      tags: [],
      component: TrivialWidget,
      dataRequirements: [],
    });
    const user = userEvent.setup();
    const addItems = vi.fn();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider addItems={addItems} updateItemConfig={vi.fn()}>
            <ComponentOverlay />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add widget" }));
    await user.click(
      await screen.findByRole("checkbox", { name: "Select Second" }),
    );
    expect(screen.getByRole("option", { name: /Second/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("Trivial");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.click(screen.getByRole("button", { name: "Add 2 widgets" }));

    expect(addItems).toHaveBeenCalledTimes(1);
    const ids = addItems.mock.calls[0][0].map(
      (e: { item: { componentId: string } }) => e.item.componentId,
    );
    expect(ids).toEqual(["second", "trivial"]);
  });

  it("marks a widget already on this layout and one on another layout", async () => {
    registerTrivial();
    registerComponent({
      id: "second",
      name: "Second",
      description: "",
      tags: [],
      component: TrivialWidget,
      dataRequirements: [],
    });
    const user = userEvent.setup();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    const { container } = render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider
            addItems={vi.fn()}
            updateItemConfig={vi.fn()}
            items={[{ componentId: "trivial" }, { componentId: "trivial" }]}
            otherLayouts={[
              { name: "Launch", items: [{ componentId: "second" }] },
            ]}
          >
            <ComponentOverlay />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add widget" }));

    expect(
      await screen.findByRole("option", { name: /On this layout x2/ }),
    ).toHaveAccessibleName(/Trivial/);
    expect(
      screen.getByRole("option", { name: /On another layout/ }),
    ).toHaveAccessibleName(/Second/);
    await user.hover(screen.getByText("On another layout"));
    expect(await screen.findByText("On Launch")).toBeInTheDocument();
    await expectNoA11yViolations(container);
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
      augmentSlots: ["roomy.sections"] as never,
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
    const addItems = vi.fn();
    const serialService = new SerialDeviceService({ screenKey: "test" });

    render(
      <ModalProvider>
        <SerialDeviceProvider service={serialService}>
          <OverlayProvider addItems={addItems} updateItemConfig={vi.fn()}>
            <ComponentOverlay />
          </OverlayProvider>
        </SerialDeviceProvider>
      </ModalProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add widget" }));
    await user.click(await screen.findByRole("option", { name: /Roomy/ }));

    expect(addItems).toHaveBeenCalledTimes(1);
    expect(addItems.mock.calls[0][0][0].placement).toMatchObject({
      w: 6,
      h: 8,
    });
  });

  describe("multi-select starts from a checkbox", () => {
    function mount() {
      registerTrivial();
      registerComponent({
        id: "second",
        name: "Second",
        description: "",
        tags: [],
        component: TrivialWidget,
        dataRequirements: [],
      });
      const addItems = vi.fn();
      const view = render(
        <ModalProvider>
          <SerialDeviceProvider
            service={new SerialDeviceService({ screenKey: "test" })}
          >
            <OverlayProvider addItems={addItems} updateItemConfig={vi.fn()}>
              <ComponentOverlay />
            </OverlayProvider>
          </SerialDeviceProvider>
        </ModalProvider>,
      );
      return { addItems, ...view };
    }
    const idsAdded = (addItems: ReturnType<typeof vi.fn>, call = 0) =>
      addItems.mock.calls[call][0].map(
        (e: { item: { componentId: string } }) => e.item.componentId,
      );

    it("a plain click on a row adds that widget at once and closes the list", async () => {
      const user = userEvent.setup();
      const { addItems } = mount();
      await user.click(screen.getByRole("button", { name: "Add widget" }));
      await user.click(await screen.findByRole("option", { name: /Second/ }));

      expect(idsAdded(addItems)).toEqual(["second"]);
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("pressing a checkbox ticks the widget without adding, and shows the Add bar", async () => {
      const user = userEvent.setup();
      const { addItems } = mount();
      await user.click(screen.getByRole("button", { name: "Add widget" }));
      const box = await screen.findByRole("checkbox", {
        name: "Select Second",
      });
      await user.click(box);

      expect(addItems).not.toHaveBeenCalled();
      expect(box).toBeChecked();
      expect(
        screen.getByRole("button", { name: "Add 1 widget" }),
      ).toBeInTheDocument();
    });

    it("once something is ticked a click on a row ticks or unticks it", async () => {
      const user = userEvent.setup();
      const { addItems } = mount();
      await user.click(screen.getByRole("button", { name: "Add widget" }));
      await user.click(
        await screen.findByRole("checkbox", { name: "Select Second" }),
      );
      await user.click(screen.getByRole("option", { name: /Trivial/ }));
      expect(addItems).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Add 2 widgets" }));

      expect(idsAdded(addItems)).toEqual(["second", "trivial"]);
    });

    it("unticking everything returns a click to adding one widget", async () => {
      const user = userEvent.setup();
      const { addItems } = mount();
      await user.click(screen.getByRole("button", { name: "Add widget" }));
      const box = await screen.findByRole("checkbox", {
        name: "Select Second",
      });
      await user.click(box);
      await user.click(box);
      expect(
        screen.queryByRole("button", { name: /^Add \d+ widget/ }),
      ).toBeNull();
      await user.click(screen.getByRole("option", { name: /Trivial/ }));

      expect(idsAdded(addItems)).toEqual(["trivial"]);
    });

    it("Space on a focused checkbox ticks it, and Enter in the search adds the highlighted widget", async () => {
      const user = userEvent.setup();
      const { addItems } = mount();
      await user.click(screen.getByRole("button", { name: "Add widget" }));
      const box = await screen.findByRole("checkbox", {
        name: "Select Second",
      });
      box.focus();
      await user.keyboard(" ");
      expect(box).toBeChecked();
      await user.keyboard(" ");
      expect(box).not.toBeChecked();

      await user.click(screen.getByRole("combobox"));
      await user.keyboard("Trivial{Enter}");
      expect(idsAdded(addItems)).toEqual(["trivial"]);
    });

    it("has no accessibility violations with the checkboxes shown", async () => {
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole("button", { name: "Add widget" }));
      await screen.findByRole("checkbox", { name: "Select Second" });
      await expectNoA11yViolations(document.body);
    });
  });
});
