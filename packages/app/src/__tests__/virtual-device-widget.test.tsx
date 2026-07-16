/**
 * Integration test for the VirtualDevice widget: pressing a button on the
 * widget → VirtualTransport.inject → SerialDeviceService event →
 * InputDispatcher → mapped action handler runs.
 */

import {
  clearActionHandlers,
  DashboardItemContext,
  registerActionHandler,
} from "@ksp-gonogo/core";
import {
  InputDispatcher,
  type InputMappingSource,
  SerialDeviceProvider,
  SerialDeviceService,
  VirtualDeviceComponent,
} from "@ksp-gonogo/serial";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => clearActionHandlers());

describe("VirtualDevice widget", () => {
  it("pressing a button dispatches the mapped action", async () => {
    const service = new SerialDeviceService({
      screenKey: "vdw",
      storage: memoryStorage(),
      renderDebounceMs: 0,
    });
    for (const d of service.getDevices()) await service.removeDevice(d.id);
    for (const t of service.getDeviceTypes())
      await service.removeDeviceType(t.id);

    service.upsertDeviceType({
      id: "panel",
      name: "Panel",
      parser: "char-position",
      inputs: [
        { id: "a", name: "A", kind: "button" },
        { id: "b", name: "B", kind: "button" },
      ],
    });
    service.addDevice({
      id: "panel-1",
      name: "Panel 1",
      typeId: "panel",
      transport: "virtual",
    });
    await service.connect("panel-1");

    const toggleSpy = vi.fn();
    registerActionHandler("ag-1", "toggle", (payload) => {
      toggleSpy(payload);
      return undefined;
    });

    const items: InputMappingSource[] = [
      {
        i: "ag-1",
        inputMappings: { toggle: { deviceId: "panel-1", inputId: "a" } },
      },
    ];
    const dispatcher = new InputDispatcher({ service, getItems: () => items });

    render(
      <SerialDeviceProvider service={service}>
        <DashboardItemContext.Provider value={{ instanceId: "vd-1" }}>
          <VirtualDeviceComponent id="vd-1" config={{ deviceId: "panel-1" }} />
        </DashboardItemContext.Provider>
      </SerialDeviceProvider>,
    );

    const btnA = screen.getByRole("button", { name: "A" });
    fireEvent.pointerDown(btnA);

    expect(toggleSpy).toHaveBeenCalledWith({ kind: "button", value: true });

    fireEvent.pointerUp(btnA);
    expect(toggleSpy).toHaveBeenCalledWith({ kind: "button", value: false });

    dispatcher.dispose();
    await service.destroy();
  });

  it("shows the rendered frame produced by an action handler", async () => {
    const service = new SerialDeviceService({
      screenKey: "vdw2",
      storage: memoryStorage(),
      renderDebounceMs: 0,
    });
    for (const d of service.getDevices()) await service.removeDevice(d.id);
    for (const t of service.getDeviceTypes())
      await service.removeDeviceType(t.id);

    service.upsertDeviceType({
      id: "panel",
      name: "Panel",
      parser: "char-position",
      renderStyleId: "text-buffer-168",
      inputs: [{ id: "a", name: "A", kind: "button" }],
    });
    service.addDevice({
      id: "panel-2",
      name: "Panel 2",
      typeId: "panel",
      transport: "virtual",
    });
    await service.connect("panel-2");

    registerActionHandler("ag-1", "toggle", () => ({ HELLO: 42 }));
    const items: InputMappingSource[] = [
      {
        i: "ag-1",
        inputMappings: { toggle: { deviceId: "panel-2", inputId: "a" } },
      },
    ];
    const dispatcher = new InputDispatcher({ service, getItems: () => items });

    render(
      <SerialDeviceProvider service={service}>
        <DashboardItemContext.Provider value={{ instanceId: "vd-2" }}>
          <VirtualDeviceComponent id="vd-2" config={{ deviceId: "panel-2" }} />
        </DashboardItemContext.Provider>
      </SerialDeviceProvider>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "A" }));

    // findByText polls inside waitFor's act boundary, so the setFrame
    // triggered by the debounced render is captured cleanly. Using a raw
    // setTimeout wait here lets the state update land outside act and
    // produces a React console warning.
    const frameEl = await screen.findByText(/HELLO 42/);
    expect(frameEl).toBeInTheDocument();

    dispatcher.dispose();
    await service.destroy();
  });
});
