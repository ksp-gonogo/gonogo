import type { ActionDefinition } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputMappingTab } from "./InputMappingTab";
import { SerialDeviceProvider } from "./SerialDeviceContext";
import { SerialDeviceService } from "./SerialDeviceService";
import type { VirtualTransport } from "./transports/VirtualTransport";

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

async function setup() {
  const svc = new SerialDeviceService({
    screenKey: `t-${Math.random().toString(36).slice(2)}`,
    storage: memoryStorage(),
    renderDebounceMs: 0,
  });
  for (const d of svc.getDevices()) await svc.removeDevice(d.id);
  for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);
  svc.upsertDeviceType({
    id: "t",
    name: "Pad",
    parser: "char-position",
    inputs: [
      { id: "a", name: "A", kind: "button" },
      { id: "b", name: "B", kind: "button" },
      { id: "x", name: "X", kind: "analog", min: -100, max: 100 },
    ],
  });
  svc.addDevice({
    id: "d1",
    name: "Pad 1",
    typeId: "t",
    transport: "virtual",
  });
  await svc.connect("d1");
  const transport = svc.getTransport("d1") as VirtualTransport;
  return { svc, transport };
}

const buttonAction: ActionDefinition = {
  id: "fire",
  label: "Fire",
  accepts: ["button"],
};
const analogAction: ActionDefinition = {
  id: "throttle",
  label: "Throttle",
  accepts: ["analog"],
};

describe("InputMappingTab press-to-map", () => {
  afterEach(() => {
    cleanup();
  });

  it("captures a button binding from the next press and writes it on Save", async () => {
    const { svc, transport } = await setup();
    const onSave = vi.fn();
    const user = userEvent.setup();

    render(
      <SerialDeviceProvider service={svc}>
        <InputMappingTab
          actions={[buttonAction]}
          mappings={{}}
          onSave={onSave}
        />
      </SerialDeviceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /capture an input for fire/i }),
    );
    expect(svc.isCaptureMode()).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/press a button/i);

    // inject() fires the input listener chain synchronously into a React
    // setState, so wrap it in act() (synchronous external push, no
    // testing-library async equivalent).
    act(() => transport.inject("b", true));

    await waitFor(() => expect(svc.isCaptureMode()).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({
      fire: { deviceId: "d1", inputId: "b" },
    });

    await svc.destroy();
  });

  it("ignores stick noise below half deflection on analog actions", async () => {
    const { svc, transport } = await setup();
    const onSave = vi.fn();
    const user = userEvent.setup();

    render(
      <SerialDeviceProvider service={svc}>
        <InputMappingTab
          actions={[analogAction]}
          mappings={{}}
          onSave={onSave}
        />
      </SerialDeviceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /capture an input for throttle/i }),
    );
    // Synchronous external pushes into the capture-mode setState — wrap in
    // act(). The first is below half-deflection (no bind), the second binds.
    act(() => transport.inject("x", 0.1));
    expect(svc.isCaptureMode()).toBe(true); // still listening

    act(() => transport.inject("x", -0.7));
    await waitFor(() => expect(svc.isCaptureMode()).toBe(false));

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({
      throttle: { deviceId: "d1", inputId: "x" },
    });

    await svc.destroy();
  });

  it("releases capture mode when Cancel is clicked", async () => {
    const { svc } = await setup();
    const user = userEvent.setup();

    render(
      <SerialDeviceProvider service={svc}>
        <InputMappingTab
          actions={[buttonAction]}
          mappings={{}}
          onSave={() => {}}
        />
      </SerialDeviceProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /capture an input for fire/i }),
    );
    expect(svc.isCaptureMode()).toBe(true);

    await user.click(
      screen.getByRole("button", { name: /cancel binding for fire/i }),
    );
    expect(svc.isCaptureMode()).toBe(false);

    await svc.destroy();
  });
});
