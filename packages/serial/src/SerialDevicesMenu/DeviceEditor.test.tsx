import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import type { DeviceInstance, DeviceType } from "../types";
import { DeviceEditor } from "./DeviceEditor";

const REAL_TYPE: DeviceType = {
  id: "demo",
  name: "Demo",
  parser: "char-position",
  inputs: [],
};

afterEach(() => cleanup());

describe("DeviceEditor — gamepad transport", () => {
  it("offers gamepad alongside virtual and web-serial", () => {
    render(
      <DeviceEditor
        types={[REAL_TYPE]}
        onCancel={() => {}}
        onSave={() => {}}
      />,
    );
    const select = screen.getByLabelText("Transport") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["virtual", "web-serial", "gamepad"]);
  });

  it("hides the Type field and the baud field when gamepad is selected", async () => {
    const user = userEvent.setup();
    render(
      <DeviceEditor
        types={[REAL_TYPE]}
        onCancel={() => {}}
        onSave={() => {}}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Transport"), "gamepad");
    expect(screen.queryByLabelText("Type")).toBeNull();
    expect(screen.queryByLabelText("Baud rate")).toBeNull();
    expect(screen.getByLabelText("Button labels")).not.toBeNull();
  });

  it("saves a brand new gamepad device against the placeholder type, with no chosen label pack", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <DeviceEditor types={[REAL_TYPE]} onCancel={() => {}} onSave={onSave} />,
    );
    await user.type(screen.getByLabelText("Name"), "My Pad");
    await user.selectOptions(screen.getByLabelText("Transport"), "gamepad");
    await user.click(screen.getByRole("button", { name: "Save device" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as DeviceInstance;
    expect(saved.typeId).toBe("gamepad-unconfigured");
    expect(saved.transport).toBe("gamepad");
    expect(saved.labelPack).toBeUndefined();
    expect(saved.gamepadId).toBeUndefined();
  });

  it("saves an explicit label pack choice instead of the auto-detect sentinel", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <DeviceEditor types={[REAL_TYPE]} onCancel={() => {}} onSave={onSave} />,
    );
    await user.type(screen.getByLabelText("Name"), "My Pad");
    await user.selectOptions(screen.getByLabelText("Transport"), "gamepad");
    await user.selectOptions(screen.getByLabelText("Button labels"), "xbox");
    await user.click(screen.getByRole("button", { name: "Save device" }));

    const saved = onSave.mock.calls[0][0] as DeviceInstance;
    expect(saved.labelPack).toBe("xbox");
  });

  it("editing an already-paired gamepad device keeps its shape-derived typeId, not the placeholder", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const existing: DeviceInstance = {
      id: "gp1",
      name: "My Pad",
      typeId: "gamepad-standard-18b-4a",
      transport: "gamepad",
      gamepadId: "Pad A",
      labelPack: "playstation",
    };
    render(
      <DeviceEditor
        initial={existing}
        types={[REAL_TYPE]}
        onCancel={() => {}}
        onSave={onSave}
      />,
    );
    // Renaming only — transport/labelPack untouched.
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed Pad");
    await user.click(screen.getByRole("button", { name: "Save device" }));

    const saved = onSave.mock.calls[0][0] as DeviceInstance;
    expect(saved.typeId).toBe("gamepad-standard-18b-4a");
    expect(saved.labelPack).toBe("playstation");
    expect(saved.name).toBe("Renamed Pad");
  });

  it("has no axe violations with gamepad selected (Button labels field shown)", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DeviceEditor
        types={[REAL_TYPE]}
        onCancel={() => {}}
        onSave={() => {}}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Transport"), "gamepad");
    expect(await axe(container)).toHaveNoViolations();
  });
});
