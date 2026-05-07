import { clearActionHandlers, registerActionHandler } from "@gonogo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputDispatcher, type InputMappingSource } from "./InputDispatcher";
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

async function makeServiceWithVirtualDevice(): Promise<{
  service: SerialDeviceService;
  transport: VirtualTransport;
}> {
  const service = new SerialDeviceService({
    screenKey: `t-${Math.random().toString(36).slice(2)}`,
    storage: memoryStorage(),
    renderDebounceMs: 0,
  });
  for (const d of service.getDevices()) await service.removeDevice(d.id);
  for (const t of service.getDeviceTypes())
    await service.removeDeviceType(t.id);

  service.upsertDeviceType({
    id: "t",
    name: "T",
    parser: "char-position",
    renderStyleId: "text-buffer-168",
    inputs: [
      { id: "a", name: "A", kind: "button" },
      { id: "x", name: "X", kind: "analog", min: 0, max: 100 },
    ],
  });
  service.addDevice({
    id: "d1",
    name: "D1",
    typeId: "t",
    transport: "virtual",
  });
  await service.connect("d1");
  const transport = service.getTransport("d1") as VirtualTransport;
  return { service, transport };
}

describe("InputDispatcher", () => {
  beforeEach(() => clearActionHandlers());

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes a serial input event to the mapped action handler", async () => {
    vi.useFakeTimers();
    const { service, transport } = await makeServiceWithVirtualDevice();
    const toggleSpy = vi.fn();
    registerActionHandler("ag-1", "toggle", (payload) => {
      toggleSpy(payload);
      return undefined;
    });

    const items: InputMappingSource[] = [
      {
        i: "ag-1",
        componentId: "action-group",
        inputMappings: { toggle: { deviceId: "d1", inputId: "a" } },
      },
    ];
    const dispatcher = new InputDispatcher({
      service,
      getItems: () => items,
    });

    transport.inject("a", true);
    expect(toggleSpy).toHaveBeenCalledWith({ kind: "button", value: true });

    dispatcher.dispose();
    await service.destroy();
  });

  it("does nothing for unmapped inputs", async () => {
    const { service, transport } = await makeServiceWithVirtualDevice();
    const spy = vi.fn();
    registerActionHandler("ag-1", "toggle", spy);

    const dispatcher = new InputDispatcher({
      service,
      getItems: () => [
        {
          i: "ag-1",
          componentId: "action-group",
          inputMappings: { toggle: { deviceId: "d1", inputId: "b" } },
        },
      ],
    });
    transport.inject("a", true); // mapped to 'b', not 'a'
    expect(spy).not.toHaveBeenCalled();

    dispatcher.dispose();
    await service.destroy();
  });

  it("forwards handler return values into the service render pipeline", async () => {
    vi.useFakeTimers();
    const { service, transport } = await makeServiceWithVirtualDevice();
    registerActionHandler("ag-1", "toggle", () => ({ SAS: true }));

    const dispatcher = new InputDispatcher({
      service,
      getItems: () => [
        {
          i: "ag-1",
          componentId: "action-group",
          inputMappings: { toggle: { deviceId: "d1", inputId: "a" } },
        },
      ],
    });

    transport.inject("a", true);
    vi.advanceTimersByTime(5);

    const frame = transport.lastFrame as string;
    expect(frame).toBeTruthy();
    expect(frame.split("\n")[0].startsWith("SAS ON")).toBe(true);

    dispatcher.dispose();
    await service.destroy();
  });

  it("reads items via getItems on every event so runtime mapping changes are picked up", async () => {
    const { service, transport } = await makeServiceWithVirtualDevice();
    const spy = vi.fn();
    registerActionHandler("ag-1", "toggle", spy);

    let items: InputMappingSource[] = [
      {
        i: "ag-1",
        componentId: "action-group",
        // Initially unbound.
        inputMappings: {},
      },
    ];
    const dispatcher = new InputDispatcher({
      service,
      getItems: () => items,
    });

    transport.inject("a", true);
    expect(spy).not.toHaveBeenCalled();

    // Simulate the user saving a mapping in the Inputs tab.
    items = [
      {
        ...items[0],
        inputMappings: { toggle: { deviceId: "d1", inputId: "a" } },
      },
    ];
    transport.inject("a", true);
    expect(spy).toHaveBeenCalledTimes(1);

    dispatcher.dispose();
    await service.destroy();
  });

  it("skips dispatch while the service is in capture mode but still notifies onInput listeners", async () => {
    const { service, transport } = await makeServiceWithVirtualDevice();
    const spy = vi.fn();
    registerActionHandler("ag-1", "toggle", spy);

    const dispatcher = new InputDispatcher({
      service,
      getItems: () => [
        {
          i: "ag-1",
          componentId: "action-group",
          inputMappings: { toggle: { deviceId: "d1", inputId: "a" } },
        },
      ],
    });

    // The mapping UI's "press to bind" listener uses onInput directly.
    const captured: Array<{ deviceId: string; inputId: string }> = [];
    const unsub = service.onInput((deviceId, event) => {
      captured.push({ deviceId, inputId: event.inputId });
    });

    service.setCaptureMode(true);
    transport.inject("a", true);
    expect(spy).not.toHaveBeenCalled();
    expect(captured).toEqual([{ deviceId: "d1", inputId: "a" }]);

    service.setCaptureMode(false);
    transport.inject("a", true);
    expect(spy).toHaveBeenCalledTimes(1);

    unsub();
    dispatcher.dispose();
    await service.destroy();
  });
});
