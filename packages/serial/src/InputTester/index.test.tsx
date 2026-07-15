import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SerialDeviceProvider } from "../SerialDeviceContext";
import { SerialDeviceService } from "../SerialDeviceService";
import { axe } from "../test/axe";
import { InputTesterComponent } from "./index";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

async function makeService(): Promise<SerialDeviceService> {
  const svc = new SerialDeviceService({
    screenKey: `t-${Math.random().toString(36).slice(2)}`,
    storage: memoryStorage(),
    renderDebounceMs: 0,
  });
  for (const d of svc.getDevices()) await svc.removeDevice(d.id);
  for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);
  return svc;
}

afterEach(() => cleanup());

describe("InputTesterComponent — gamepad glyph rendering", () => {
  it("renders the pack's name + glyph for a gamepad input with a role", async () => {
    const svc = await makeService();
    svc.upsertDeviceType({
      id: "gamepad-standard-17b-4a",
      name: "Gamepad",
      parser: "json-state",
      authoredBy: "device",
      inputs: [
        {
          id: "button-0",
          name: "Face South",
          kind: "button",
          role: "face-south",
        },
        {
          id: "axis-0",
          name: "Stick Left X",
          kind: "analog",
          polarity: "bipolar",
          role: "stick-left-x",
        },
      ],
    });
    svc.addDevice({
      id: "gp1",
      name: "My Pad",
      typeId: "gamepad-standard-17b-4a",
      transport: "gamepad",
      labelPack: "nintendo",
    });

    render(
      <SerialDeviceProvider service={svc}>
        <InputTesterComponent config={{ deviceId: "gp1" }} />
      </SerialDeviceProvider>,
    );

    // Nintendo's face-south is "B", not "A" (Xbox) or "Face South" (positional).
    expect(screen.getByText("B")).not.toBeNull();
    expect(screen.getByText("Left Stick X")).not.toBeNull();
    expect(document.querySelector('[aria-hidden="true"] svg')).not.toBeNull();

    await svc.destroy();
  });

  it("has no axe violations with a gamepad device selected and glyphs rendered", async () => {
    const svc = await makeService();
    svc.upsertDeviceType({
      id: "gamepad-standard-17b-4a",
      name: "Gamepad",
      parser: "json-state",
      authoredBy: "device",
      inputs: [
        {
          id: "button-0",
          name: "Face South",
          kind: "button",
          role: "face-south",
        },
        {
          id: "axis-0",
          name: "Stick Left X",
          kind: "analog",
          polarity: "bipolar",
          role: "stick-left-x",
        },
      ],
    });
    svc.addDevice({
      id: "gp1",
      name: "My Pad",
      typeId: "gamepad-standard-17b-4a",
      transport: "gamepad",
      labelPack: "xbox",
    });

    const { container } = render(
      <SerialDeviceProvider service={svc}>
        <InputTesterComponent config={{ deviceId: "gp1" }} />
      </SerialDeviceProvider>,
    );

    expect(await axe(container)).toHaveNoViolations();
    await svc.destroy();
  });

  it("falls back to the input's own name with no glyph for a non-gamepad device", async () => {
    const svc = await makeService();
    svc.upsertDeviceType({
      id: "t",
      name: "Panel",
      parser: "char-position",
      inputs: [{ id: "a", name: "Stage", kind: "button" }],
    });
    svc.addDevice({
      id: "v1",
      name: "Panel 1",
      typeId: "t",
      transport: "virtual",
    });

    render(
      <SerialDeviceProvider service={svc}>
        <InputTesterComponent config={{ deviceId: "v1" }} />
      </SerialDeviceProvider>,
    );

    expect(screen.getByText("Stage")).not.toBeNull();
    expect(document.querySelector("svg")).toBeNull();

    await svc.destroy();
  });
});
