import { memoryStorage } from "@gonogo/core/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SerialDeviceService } from "./SerialDeviceService";
import type { VirtualTransport } from "./transports/VirtualTransport";
import type { DeviceInstance, DeviceType } from "./types";

const TYPE: DeviceType = {
  id: "demo",
  name: "Demo",
  parser: "char-position",
  renderStyleId: "text-buffer-168",
  inputs: [
    { id: "a", name: "A", kind: "button" },
    { id: "x", name: "X", kind: "analog", min: 0, max: 100 },
  ],
};

const INSTANCE: DeviceInstance = {
  id: "d1",
  name: "Demo 1",
  typeId: TYPE.id,
  transport: "virtual",
};

async function makeService(
  opts: { renderDebounceMs?: number } = {},
): Promise<SerialDeviceService> {
  const storage = memoryStorage();
  const svc = new SerialDeviceService({
    screenKey: "test",
    storage,
    renderDebounceMs: opts.renderDebounceMs ?? 0,
  });
  // Wipe the seeded defaults so tests have full control.
  for (const d of svc.getDevices()) await svc.removeDevice(d.id);
  for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);
  return svc;
}

describe("SerialDeviceService", () => {
  let service: SerialDeviceService;

  beforeEach(async () => {
    vi.useFakeTimers();
    service = await makeService();
    service.upsertDeviceType(TYPE);
    service.addDevice(INSTANCE);
  });

  afterEach(async () => {
    await service.destroy();
    vi.useRealTimers();
  });

  it("forwards transport input events to subscribers with the deviceId", () => {
    const events: Array<{ deviceId: string; inputId: string; value: unknown }> =
      [];
    service.onInput((deviceId, event) =>
      events.push({ deviceId, inputId: event.inputId, value: event.value }),
    );

    const transport = service.getTransport("d1") as VirtualTransport;
    transport.inject("a", true);
    transport.inject("x", 0.5);

    expect(events).toEqual([
      { deviceId: "d1", inputId: "a", value: true },
      { deviceId: "d1", inputId: "x", value: 0.5 },
    ]);
  });

  it("recordActionReturn debounces and renders via the registered style", () => {
    const transport = service.getTransport("d1") as VirtualTransport;

    service.recordActionReturn("d1", { ALT: 1 });
    service.recordActionReturn("d1", { THR: 2 });
    // Before the debounce window expires, nothing has been written yet.
    expect(transport.lastFrame).toBeNull();

    vi.advanceTimersByTime(5);
    const frame = transport.lastFrame as string;
    expect(typeof frame).toBe("string");
    // text-buffer renders as a flat 21×8 buffer (no row separators).
    // Keys are sorted — ALT first, THR second.
    expect(frame.slice(0, 21).startsWith("ALT 1")).toBe(true);
    expect(frame.slice(21, 42).startsWith("THR 2")).toBe(true);
  });

  it("merges sequential action returns into one frame", () => {
    const transport = service.getTransport("d1") as VirtualTransport;

    service.recordActionReturn("d1", { ALT: 1 });
    vi.advanceTimersByTime(5);
    const first = transport.lastFrame as string;

    service.recordActionReturn("d1", { THR: 2 });
    vi.advanceTimersByTime(5);
    const second = transport.lastFrame as string;

    // Second frame retains ALT from the merged state and adds THR.
    expect(first.slice(0, 21).startsWith("ALT 1")).toBe(true);
    expect(second.slice(0, 21).startsWith("ALT 1")).toBe(true);
    expect(second.slice(21, 42).startsWith("THR 2")).toBe(true);
  });

  it("ignores non-object action returns", () => {
    const transport = service.getTransport("d1") as VirtualTransport;

    service.recordActionReturn("d1", undefined);
    service.recordActionReturn("d1", "hello");
    service.recordActionReturn("d1", 42);
    vi.advanceTimersByTime(5);

    expect(transport.lastFrame).toBeNull();
  });

  it("persists device types and instances across service restarts", () => {
    const storage = memoryStorage();
    const first = new SerialDeviceService({
      screenKey: "persist",
      storage,
      renderDebounceMs: 0,
    });
    // Clear seeded defaults so we assert only the change we make.
    for (const d of first.getDevices()) void first.removeDevice(d.id);
    for (const t of first.getDeviceTypes()) first.removeDeviceType(t.id);
    first.upsertDeviceType(TYPE);
    first.addDevice(INSTANCE);

    const second = new SerialDeviceService({
      screenKey: "persist",
      storage,
      renderDebounceMs: 0,
    });
    expect(second.getDeviceTypes().map((t) => t.id)).toContain("demo");
    expect(second.getDevices().map((d) => d.id)).toContain("d1");
  });

  it("removing a device type also removes its instances", async () => {
    await service.removeDeviceType(TYPE.id);
    expect(service.getDevices()).toEqual([]);
    expect(service.getDeviceType(TYPE.id)).toBeUndefined();
  });

  it("connect()/disconnect() reflect on the transport status", async () => {
    expect(service.getStatus("d1")).toBe("disconnected");
    await service.connect("d1");
    expect(service.getStatus("d1")).toBe("connected");
    await service.disconnect("d1");
    expect(service.getStatus("d1")).toBe("disconnected");
  });
});

describe("SerialDeviceService seeding", () => {
  it("seeds the virtual controller type + instance when storage is empty", () => {
    const storage = memoryStorage();
    const svc = new SerialDeviceService({
      screenKey: "fresh",
      storage,
      renderDebounceMs: 0,
    });
    const types = svc.getDeviceTypes();
    const devices = svc.getDevices();
    expect(types.some((t) => t.id === "virtual-controller")).toBe(true);
    expect(devices.some((d) => d.typeId === "virtual-controller")).toBe(true);
  });

  it("does not re-seed once device types exist", async () => {
    const storage = memoryStorage();
    // First service writes a non-default type then tears down.
    const first = new SerialDeviceService({
      screenKey: "noreseed",
      storage,
      renderDebounceMs: 0,
    });
    // Remove the seeded instance/type and add something else so storage is
    // non-empty but without the virtual controller.
    for (const d of first.getDevices()) await first.removeDevice(d.id);
    for (const t of first.getDeviceTypes()) await first.removeDeviceType(t.id);
    first.upsertDeviceType({
      id: "other",
      name: "Other",
      parser: "char-position",
      inputs: [],
    });
    // Re-open. Because types are non-empty, the seeder must not fire.
    const second = new SerialDeviceService({
      screenKey: "noreseed",
      storage,
      renderDebounceMs: 0,
    });
    expect(second.getDeviceType("virtual-controller")).toBeUndefined();
  });
});

describe("SerialDeviceService — json-state schema updates", () => {
  /**
   * Fake transport that pretends to be a WebSerialTransport: it hosts
   * onSchema listeners and lets the test fire schema updates manually.
   */
  class FakeJsonTransport {
    readonly id: string;
    status = "connected" as const;
    type: DeviceType;
    lastFrame: string | Uint8Array | null = null;

    private inputSubs = new Set<
      (e: { inputId: string; value: boolean | number }) => void
    >();
    private statusSubs = new Set<
      (s: "disconnected" | "connected" | "error") => void
    >();
    private schemaSubs = new Set<
      (u: {
        inputs?: DeviceInput[] | null;
        screen?: { type: string; [k: string]: unknown } | null;
      }) => void
    >();

    constructor(id: string, type: DeviceType) {
      this.id = id;
      this.type = type;
    }

    async connect() {}
    async disconnect() {}
    async write(data: string | Uint8Array) {
      this.lastFrame = data;
    }
    onInput(cb: (e: { inputId: string; value: boolean | number }) => void) {
      this.inputSubs.add(cb);
      return () => this.inputSubs.delete(cb);
    }
    onStatus(cb: (s: "disconnected" | "connected" | "error") => void) {
      this.statusSubs.add(cb);
      return () => this.statusSubs.delete(cb);
    }
    onSchema(
      cb: (u: {
        inputs?: DeviceInput[] | null;
        screen?: { type: string; [k: string]: unknown } | null;
      }) => void,
    ) {
      this.schemaSubs.add(cb);
      return () => this.schemaSubs.delete(cb);
    }
    updateDeviceType(t: DeviceType) {
      this.type = t;
    }

    // test-only: drive a schema update as if it had come from the wire
    fireSchema(update: {
      inputs?: DeviceInput[] | null;
      screen?: { type: string; [k: string]: unknown } | null;
    }) {
      for (const cb of this.schemaSubs) cb(update);
    }
  }

  const BARE_JSON_TYPE: DeviceType = {
    id: "json-panel",
    name: "JSON Panel",
    parser: "json-state",
    inputs: [],
  };
  const JSON_INSTANCE: DeviceInstance = {
    id: "jp1",
    name: "JSON Panel 1",
    typeId: BARE_JSON_TYPE.id,
    transport: "web-serial",
  };

  async function makeWithFakeTransport(): Promise<{
    svc: SerialDeviceService;
    transport: FakeJsonTransport;
  }> {
    let transport: FakeJsonTransport | null = null;
    const storage = memoryStorage();
    const svc = new SerialDeviceService({
      screenKey: "json-test",
      storage,
      renderDebounceMs: 0,
      transportFactory: (instance, type) => {
        const t = new FakeJsonTransport(instance.id, type);
        transport = t;
        return t as unknown as ReturnType<
          NonNullable<
            ConstructorParameters<
              typeof SerialDeviceService
            >[0]["transportFactory"]
          >
        >;
      },
    });
    for (const d of svc.getDevices()) await svc.removeDevice(d.id);
    for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);
    svc.upsertDeviceType(BARE_JSON_TYPE);
    svc.addDevice(JSON_INSTANCE);
    if (!transport) throw new Error("transport factory did not run");
    return { svc, transport };
  }

  it("upserts newly-reported inputs onto the type and flips authoredBy to device", async () => {
    const { svc, transport } = await makeWithFakeTransport();
    transport.fireSchema({
      inputs: [
        { id: "A", name: "A", kind: "button" },
        { id: "X", name: "X", kind: "analog", min: 0, max: 1023 },
      ],
      screen: null,
    });
    const type = svc.getDeviceType(BARE_JSON_TYPE.id);
    expect(type?.inputs).toHaveLength(2);
    expect(type?.authoredBy).toBe("device");
    // Transport's cached type was also updated.
    expect(transport.type.inputs).toHaveLength(2);
  });

  it("wires the text-buffer render style + config from a txt screen block", async () => {
    const { svc, transport } = await makeWithFakeTransport();
    transport.fireSchema({
      inputs: null,
      screen: { type: "txt", w: 40, h: 4 },
    });
    const type = svc.getDeviceType(BARE_JSON_TYPE.id);
    expect(type?.renderStyleId).toBe("text-buffer");
    expect(type?.renderStyleConfig).toEqual({ w: 40, h: 4 });
  });

  it("ignores unknown screen types (leaves renderStyleId untouched)", async () => {
    const { svc, transport } = await makeWithFakeTransport();
    transport.fireSchema({
      inputs: null,
      screen: { type: "rgb", w: 160, h: 120 },
    });
    const type = svc.getDeviceType(BARE_JSON_TYPE.id);
    expect(type?.renderStyleId).toBeUndefined();
  });
});

describe("SerialDeviceService autoReconnect", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("adopts a previously-authorised port that matches by VID/PID", async () => {
    const { MockWebSerial } = await import("./mocks/mockWebSerial");
    const { WebSerialTransport } = await import(
      "./transports/WebSerialTransport"
    );

    const mock = new MockWebSerial();
    mock.install({ force: true });
    try {
      mock.createPort({
        info: { usbVendorId: 0x1234, usbProductId: 0x5678 },
      });

      const storage = memoryStorage();
      const svc = new SerialDeviceService({
        screenKey: "test",
        storage,
        transportFactory: (instance, deviceType) =>
          new WebSerialTransport({
            id: instance.id,
            deviceType,
            baudRate: instance.baudRate,
            filters: instance.filters,
          }),
      });
      for (const d of svc.getDevices()) await svc.removeDevice(d.id);
      for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);

      svc.upsertDeviceType(TYPE);
      svc.addDevice({
        id: "hw1",
        name: "Hardware",
        typeId: TYPE.id,
        transport: "web-serial",
        portInfo: { vendorId: 0x1234, productId: 0x5678 },
      });

      expect(svc.getStatus("hw1")).toBe("disconnected");
      await svc.autoReconnect();
      expect(svc.getStatus("hw1")).toBe("connected");

      await svc.destroy();
    } finally {
      mock.restore();
    }
  });

  it("does not adopt when two ports match (ambiguous)", async () => {
    const { MockWebSerial } = await import("./mocks/mockWebSerial");
    const { WebSerialTransport } = await import(
      "./transports/WebSerialTransport"
    );

    const mock = new MockWebSerial();
    mock.install({ force: true });
    try {
      mock.createPort({
        info: { usbVendorId: 0xaaaa, usbProductId: 0xbbbb },
      });
      mock.createPort({
        info: { usbVendorId: 0xaaaa, usbProductId: 0xbbbb },
      });

      const storage = memoryStorage();
      const svc = new SerialDeviceService({
        screenKey: "test",
        storage,
        transportFactory: (instance, deviceType) =>
          new WebSerialTransport({
            id: instance.id,
            deviceType,
            baudRate: instance.baudRate,
            filters: instance.filters,
          }),
      });
      for (const d of svc.getDevices()) await svc.removeDevice(d.id);
      for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);

      svc.upsertDeviceType(TYPE);
      svc.addDevice({
        id: "hw2",
        name: "Hardware",
        typeId: TYPE.id,
        transport: "web-serial",
        portInfo: { vendorId: 0xaaaa, productId: 0xbbbb },
      });

      await svc.autoReconnect();
      // Ambiguous match — current-functionality fallback of leaving the
      // device disconnected so the user picks explicitly.
      expect(svc.getStatus("hw2")).toBe("disconnected");
      await svc.destroy();
    } finally {
      mock.restore();
    }
  });

  it("is a no-op when navigator.serial is absent", async () => {
    const svc = await makeService();
    svc.upsertDeviceType(TYPE);
    svc.addDevice({
      id: "v1",
      name: "Virtual",
      typeId: TYPE.id,
      transport: "virtual",
    });
    await expect(svc.autoReconnect()).resolves.toBeUndefined();
    await svc.destroy();
  });
});
