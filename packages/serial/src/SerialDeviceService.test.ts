import { memoryStorage } from "@ksp-gonogo/core/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockGamepadAPI } from "./mocks/mockGamepad";
import { SerialDeviceService } from "./SerialDeviceService";
import type {
  DeviceTransport,
  InputEvent,
  SchemaUpdate,
  TransportStatus,
} from "./transports/DeviceTransport";
import { GamepadPoller } from "./transports/GamepadPoller";
import { GamepadTransport } from "./transports/GamepadTransport";
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
    // Keys are sorted, ALT first, THR second.
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
    // Remove the seeded instance/type and add something else so storage is non-empty but without the virtual controller.
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

describe("SerialDeviceService: json-state schema updates", () => {
  /**
   * Fake transport that pretends to be a WebSerialTransport: it hosts
   * onSchema listeners and lets the test fire schema updates manually.
   */
  class FakeJsonTransport implements DeviceTransport {
    readonly id: string;
    status = "connected" as const;
    type: DeviceType;
    lastFrame: string | Uint8Array | null = null;

    private inputSubs = new Set<(e: InputEvent) => void>();
    private statusSubs = new Set<(s: TransportStatus) => void>();
    private schemaSubs = new Set<(u: SchemaUpdate) => void>();

    constructor(id: string, type: DeviceType) {
      this.id = id;
      this.type = type;
    }

    async connect() {}
    async disconnect() {}
    async write(data: string | Uint8Array) {
      this.lastFrame = data;
    }
    onInput(cb: (e: InputEvent) => void) {
      this.inputSubs.add(cb);
      return () => this.inputSubs.delete(cb);
    }
    onStatus(cb: (s: TransportStatus) => void) {
      this.statusSubs.add(cb);
      return () => this.statusSubs.delete(cb);
    }
    onSchema(cb: (u: SchemaUpdate) => void) {
      this.schemaSubs.add(cb);
      return () => this.schemaSubs.delete(cb);
    }
    updateDeviceType(t: DeviceType) {
      this.type = t;
    }

    // test-only: drive a schema update as if it had come from the wire
    fireSchema(update: SchemaUpdate) {
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
        return t;
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

  it("saves the type once when a device repeats the same screen and inputs on every line", async () => {
    const { svc, transport } = await makeWithFakeTransport();
    const update: SchemaUpdate = {
      inputs: [{ id: "A", name: "A", kind: "button" }],
      screen: { type: "txt", w: 40, h: 4 },
    };
    transport.fireSchema(update);
    let changes = 0;
    svc.onDeviceTypesChange(() => {
      changes++;
    });
    for (let i = 0; i < 50; i++) transport.fireSchema(structuredClone(update));
    expect(changes).toBe(0);
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

describe("SerialDeviceService: gamepad wiring", () => {
  // Real GamepadTransport + MockGamepadAPI end-to-end, per the repo's
  // testing philosophy: mock only the network/browser boundary
  // (navigator.getGamepads / gamepadconnected), not the transport itself.
  const mock = new MockGamepadAPI();
  let svc: SerialDeviceService | null = null;

  afterEach(async () => {
    await svc?.destroy();
    svc = null;
    mock.restore();
    GamepadPoller.resetForTests();
  });

  async function makeGamepadService(): Promise<SerialDeviceService> {
    const storage = memoryStorage();
    const created = new SerialDeviceService({
      screenKey: "gamepad-test",
      storage,
      renderDebounceMs: 0,
    });
    for (const d of created.getDevices()) await created.removeDevice(d.id);
    svc = created;
    return created;
  }

  it("always ensures the gamepad placeholder type exists, even with other types already present", async () => {
    const created = await makeGamepadService();
    created.upsertDeviceType(TYPE);
    expect(created.getDeviceType("gamepad-unconfigured")).toBeDefined();
  });

  it("re-points a device at a shape-derived type on first pairing, and preselects a label pack from the pad id", async () => {
    mock.install();
    const created = await makeGamepadService();
    created.addDevice({
      id: "gp1",
      name: "My Pad",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
    });

    await created.connect("gp1");
    mock.connectPad(0, {
      id: "054c-0ce6-DualSense Wireless Controller",
      buttonCount: 18,
      axisCount: 4,
    });

    const device = created.getDevices().find((d) => d.id === "gp1");
    expect(device?.typeId).toBe("gamepad-standard-18b-4a");
    expect(device?.gamepadId).toBe("054c-0ce6-DualSense Wireless Controller");
    expect(device?.labelPack).toBe("playstation");

    const type = created.getDeviceType("gamepad-standard-18b-4a");
    expect(type?.inputs).toHaveLength(22);
    expect(type?.authoredBy).toBe("device");
  });

  it("connects a saved gamepad on autoReconnect, with no click in the Devices menu", async () => {
    mock.install();
    mock.connectPad(0, { id: "Pad A", buttonCount: 18, axisCount: 4 });
    const created = await makeGamepadService();
    created.addDevice({
      id: "gp1",
      name: "My Pad",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
      gamepadId: "Pad A",
    });
    expect(created.getStatus("gp1")).toBe("disconnected");
    await created.autoReconnect();
    expect(created.getStatus("gp1")).toBe("connected");
  });

  it("shares one type between two pads of the same shape", async () => {
    mock.install();
    const created = await makeGamepadService();
    created.addDevice({
      id: "gp1",
      name: "Pad 1",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
    });
    created.addDevice({
      id: "gp2",
      name: "Pad 2",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
    });

    await created.connect("gp1");
    mock.connectPad(0, { id: "Pad A", buttonCount: 17, axisCount: 4 });
    await created.connect("gp2");
    mock.connectPad(1, { id: "Pad B", buttonCount: 17, axisCount: 4 });

    const d1 = created.getDevices().find((d) => d.id === "gp1");
    const d2 = created.getDevices().find((d) => d.id === "gp2");
    expect(d1?.typeId).toBe(d2?.typeId);
    // Only one type was created for the shape, not two.
    expect(
      created.getDeviceTypes().filter((t) => t.id.startsWith("gamepad-")),
    ).toHaveLength(2); // the placeholder + the one shape type
  });

  it("never re-detects the label pack once a pairing already set one", async () => {
    mock.install();
    const created = await makeGamepadService();
    created.addDevice({
      id: "gp1",
      name: "My Pad",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
      labelPack: "xbox", // user's explicit override, pre-set
    });

    await created.connect("gp1");
    // A Sony vendor id would normally detect "playstation", but a pack is already set, so it must survive untouched.
    mock.connectPad(0, {
      id: "054c-0ce6-DualSense Wireless Controller",
      buttonCount: 18,
      axisCount: 4,
    });

    const device = created.getDevices().find((d) => d.id === "gp1");
    expect(device?.labelPack).toBe("xbox");
  });

  it("survives removing a never-paired gamepad device: the placeholder stays available for the next add", async () => {
    mock.install();
    const created = await makeGamepadService();
    created.addDevice({
      id: "gp1",
      name: "Unpaired",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
    });
    await created.removeDevice("gp1");
    expect(created.getDeviceType("gamepad-unconfigured")).toBeDefined();

    // Confirms it's still usable, not just present.
    expect(() =>
      created.addDevice({
        id: "gp2",
        name: "Second",
        typeId: "gamepad-unconfigured",
        transport: "gamepad",
      }),
    ).not.toThrow();
  });

  it("defaultTransportFactory constructs a real GamepadTransport for transport: 'gamepad'", async () => {
    const created = await makeGamepadService();
    created.addDevice({
      id: "gp1",
      name: "My Pad",
      typeId: "gamepad-unconfigured",
      transport: "gamepad",
    });
    expect(created.getTransport("gp1")).toBeInstanceOf(GamepadTransport);
  });

  it("loads a pre-existing (pre-gamepad-feature) localStorage payload unchanged, and still adds the placeholder type", async () => {
    // Shape of gonogo.serial.device-types / gonogo.serial.devices as saved
    // by a build before this feature existed, no polarity/role/labelPack/
    // gamepadId fields anywhere, no "gamepad-unconfigured" type.
    const preExistingType: DeviceType = {
      id: "legacy-panel",
      name: "Legacy Panel",
      parser: "char-position",
      inputs: [
        { id: "a", name: "A", kind: "button" },
        { id: "x", name: "X", kind: "analog", min: -100, max: 100 },
      ],
    };
    const preExistingDevice: DeviceInstance = {
      id: "legacy-1",
      name: "Legacy 1",
      typeId: "legacy-panel",
      transport: "web-serial",
      baudRate: 9600,
    };
    const storage = memoryStorage();
    storage.setItem(
      "gonogo.serial.device-types",
      JSON.stringify([preExistingType]),
    );
    storage.setItem(
      "gonogo.serial.devices.legacy-screen",
      JSON.stringify([preExistingDevice]),
    );

    const created = new SerialDeviceService({
      screenKey: "legacy-screen",
      storage,
      renderDebounceMs: 0,
    });
    svc = created;

    // The pre-existing type and device load byte-for-byte, untouched.
    expect(created.getDeviceType("legacy-panel")).toEqual(preExistingType);
    expect(created.getDevices().find((d) => d.id === "legacy-1")).toEqual(
      preExistingDevice,
    );
    // The gamepad placeholder is additive, not a migration of anything.
    expect(created.getDeviceType("gamepad-unconfigured")).toBeDefined();
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
      // Ambiguous match: device stays disconnected and the candidate ports are parked for the UI to resolve.
      expect(svc.getStatus("hw2")).toBe("disconnected");
      const choices = svc.getPendingChoices().get("hw2");
      expect(choices?.length).toBe(2);

      // Picking the first one connects the device and clears the entry.
      await svc.resolvePendingChoice("hw2", 0);
      expect(svc.getStatus("hw2")).toBe("connected");
      expect(svc.getPendingChoices().has("hw2")).toBe(false);

      await svc.destroy();
    } finally {
      mock.restore();
    }
  });

  it("notifies onPendingChoicesChange when ambiguous matches are parked and resolved", async () => {
    const { MockWebSerial } = await import("./mocks/mockWebSerial");
    const { WebSerialTransport } = await import(
      "./transports/WebSerialTransport"
    );

    const mock = new MockWebSerial();
    mock.install({ force: true });
    try {
      mock.createPort({
        info: { usbVendorId: 0xcafe, usbProductId: 0xbeef },
      });
      mock.createPort({
        info: { usbVendorId: 0xcafe, usbProductId: 0xbeef },
      });

      const svc = new SerialDeviceService({
        screenKey: "test",
        storage: memoryStorage(),
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
        id: "hw3",
        name: "Hardware",
        typeId: TYPE.id,
        transport: "web-serial",
        portInfo: { vendorId: 0xcafe, productId: 0xbeef },
      });

      const events: number[] = [];
      svc.onPendingChoicesChange(() => {
        events.push(svc.getPendingChoices().size);
      });

      await svc.autoReconnect();
      await svc.resolvePendingChoice("hw3", 1);
      expect(events).toEqual([1, 0]);

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

describe("SerialDeviceService device-authored type cleanup", () => {
  it("removes a device-authored type when its last referring device is removed", async () => {
    const svc = await makeService();
    svc.upsertDeviceType({
      id: "auto-x",
      name: "(self-describing)",
      parser: "json-state",
      authoredBy: "device",
      inputs: [],
    });
    svc.addDevice({
      id: "sd-1",
      name: "SD",
      typeId: "auto-x",
      transport: "virtual",
    });
    expect(svc.getDeviceType("auto-x")).toBeDefined();
    await svc.removeDevice("sd-1");
    expect(svc.getDeviceType("auto-x")).toBeUndefined();
    await svc.destroy();
  });

  it("keeps a user-authored type even after its last device is removed", async () => {
    const svc = await makeService();
    svc.upsertDeviceType(TYPE);
    svc.addDevice({
      id: "v1",
      name: "V",
      typeId: TYPE.id,
      transport: "virtual",
    });
    await svc.removeDevice("v1");
    expect(svc.getDeviceType(TYPE.id)).toBeDefined();
    await svc.destroy();
  });
});

describe("SerialDeviceService hot-plug", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("adopts a port that fires a 'connect' event after the service is constructed", async () => {
    const { MockWebSerial } = await import("./mocks/mockWebSerial");
    const { WebSerialTransport } = await import(
      "./transports/WebSerialTransport"
    );

    const mock = new MockWebSerial();
    mock.install({ force: true });
    try {
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

      // Simulate the user plugging the controller in.
      const port = mock.createPort({
        info: { usbVendorId: 0x1234, usbProductId: 0x5678 },
      });
      mock.fireConnect(port);

      // tryAdoptPort awaits transport.connect; vi.waitFor polls past the microtask chain so this stays robust if the chain length changes.
      await vi.waitFor(() => expect(svc.getStatus("hw1")).toBe("connected"));

      await svc.destroy();
    } finally {
      mock.restore();
    }
  });

  it("ignores 'connect' for a port whose VID/PID matches no saved device", async () => {
    const { MockWebSerial } = await import("./mocks/mockWebSerial");
    const { WebSerialTransport } = await import(
      "./transports/WebSerialTransport"
    );

    const mock = new MockWebSerial();
    mock.install({ force: true });
    try {
      const svc = new SerialDeviceService({
        screenKey: "test",
        storage: memoryStorage(),
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

      // Different VID: should be ignored.
      const port = mock.createPort({
        info: { usbVendorId: 0xdead, usbProductId: 0xbeef },
      });
      mock.fireConnect(port);
      // Give tryAdoptPort one event-loop turn to early-return.
      await new Promise((r) => setTimeout(r, 0));
      expect(svc.getStatus("hw1")).toBe("disconnected");

      await svc.destroy();
    } finally {
      mock.restore();
    }
  });
});

describe("SerialDeviceService: two web-serial panels", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  async function twoPanels(second: { vendorId: number; productId: number }) {
    const { MockWebSerial } = await import("./mocks/mockWebSerial");
    const { WebSerialTransport } = await import(
      "./transports/WebSerialTransport"
    );
    const mock = new MockWebSerial();
    mock.install({ force: true });
    const svc = new SerialDeviceService({
      screenKey: "test",
      storage: memoryStorage(),
      transportFactory: (instance, deviceType) =>
        new WebSerialTransport({ id: instance.id, deviceType }),
    });
    for (const d of svc.getDevices()) await svc.removeDevice(d.id);
    for (const t of svc.getDeviceTypes()) await svc.removeDeviceType(t.id);
    svc.upsertDeviceType(TYPE);
    const first = { vendorId: 0x1111, productId: 0x0001 };
    svc.addDevice({
      id: "a",
      name: "Panel A",
      typeId: TYPE.id,
      transport: "web-serial",
      portInfo: first,
    });
    svc.addDevice({
      id: "b",
      name: "Panel B",
      typeId: TYPE.id,
      transport: "web-serial",
      portInfo: second,
    });
    const portA = mock.createPort({
      info: { usbVendorId: first.vendorId, usbProductId: first.productId },
    });
    const portB = mock.createPort({
      info: { usbVendorId: second.vendorId, usbProductId: second.productId },
    });
    await svc.connect("a", { port: portA });
    await svc.connect("b", { port: portB });
    expect(svc.getStatus("a")).toBe("connected");
    expect(svc.getStatus("b")).toBe("connected");
    return { mock, svc, portA, portB };
  }

  it("leaves one panel connected when a different panel's port reports a connect", async () => {
    const { mock, svc, portB } = await twoPanels({
      vendorId: 0x2222,
      productId: 0x0002,
    });
    try {
      const seen: TransportStatus[] = [];
      svc.onStatusChange((deviceId, status) => {
        if (deviceId === "a") seen.push(status);
      });
      mock.fireConnect(portB);
      await new Promise((r) => setTimeout(r, 20));
      expect(seen).toEqual([]);
      expect(svc.getStatus("a")).toBe("connected");
      await svc.destroy();
    } finally {
      mock.restore();
    }
  });

  it("disconnects only the unplugged panel of two identical ones", async () => {
    const { mock, svc, portA } = await twoPanels({
      vendorId: 0x1111,
      productId: 0x0001,
    });
    try {
      mock.fireDisconnect(portA);
      await vi.waitFor(() => expect(svc.getStatus("a")).toBe("disconnected"));
      expect(svc.getStatus("b")).toBe("connected");
      await svc.destroy();
    } finally {
      mock.restore();
    }
  });
});

describe("SerialDeviceService: updateDevice", () => {
  it("keeps the transport, and its connection, across a rename", async () => {
    const svc = await makeService();
    svc.upsertDeviceType(TYPE);
    svc.addDevice(INSTANCE);
    await svc.connect("d1");
    const before = svc.getTransport("d1");
    svc.updateDevice("d1", { ...INSTANCE, name: "Renamed" });
    expect(svc.getTransport("d1")).toBe(before);
    expect(svc.getStatus("d1")).toBe("connected");
    expect(svc.getDevice("d1")?.name).toBe("Renamed");
    await svc.destroy();
  });

  it("reconnects a connected device whose transport had to be rebuilt", async () => {
    const svc = await makeService();
    svc.upsertDeviceType(TYPE);
    svc.addDevice(INSTANCE);
    await svc.connect("d1");
    const before = svc.getTransport("d1");
    svc.updateDevice("d1", { ...INSTANCE, baudRate: 115200 });
    expect(svc.getTransport("d1")).not.toBe(before);
    await vi.waitFor(() => expect(svc.getStatus("d1")).toBe("connected"));
    await svc.destroy();
  });
});

describe("SerialDeviceService: a transport that releases on disconnect", () => {
  class HoldingTransport implements DeviceTransport {
    readonly id = "hold";
    status: TransportStatus = "connected";
    private inputSubs = new Set<(e: InputEvent) => void>();
    async connect() {}
    async disconnect() {
      for (const cb of this.inputSubs) cb({ inputId: "a", value: false });
    }
    async write() {}
    onInput(cb: (e: InputEvent) => void) {
      this.inputSubs.add(cb);
      return () => this.inputSubs.delete(cb);
    }
    onStatus() {
      return () => {};
    }
  }

  it("delivers the release to input subscribers when the device is removed", async () => {
    const svc = new SerialDeviceService({
      screenKey: "hold-test",
      storage: memoryStorage(),
      transportFactory: () => new HoldingTransport(),
    });
    svc.upsertDeviceType(TYPE);
    svc.addDevice({ ...INSTANCE, id: "held" });
    const events: InputEvent[] = [];
    svc.onInput((deviceId, event) => {
      if (deviceId === "held") events.push(event);
    });
    await svc.removeDevice("held");
    expect(events).toEqual([{ inputId: "a", value: false }]);
    await svc.destroy();
  });
});

describe("SerialDeviceService: device types shared between screens", () => {
  const OTHER: DeviceType = { ...TYPE, id: "other", name: "Other" };

  it("keeps a type another screen saved when this screen saves its own", async () => {
    const storage = memoryStorage();
    const main = new SerialDeviceService({ screenKey: "main", storage });
    const station = new SerialDeviceService({ screenKey: "station", storage });
    main.upsertDeviceType(TYPE);
    station.upsertDeviceType(OTHER);

    const reloaded = new SerialDeviceService({ screenKey: "main", storage });
    const ids = reloaded.getDeviceTypes().map((t) => t.id);
    expect(ids).toContain(TYPE.id);
    expect(ids).toContain(OTHER.id);
    expect(station.getDeviceType(TYPE.id)).toBeDefined();
    await main.destroy();
    await station.destroy();
    await reloaded.destroy();
  });

  it("does not bring back a type this screen removed", async () => {
    const storage = memoryStorage();
    const main = new SerialDeviceService({ screenKey: "main", storage });
    main.upsertDeviceType(TYPE);
    await main.removeDeviceType(TYPE.id);
    main.upsertDeviceType(OTHER);
    expect(main.getDeviceType(TYPE.id)).toBeUndefined();
    await main.destroy();
  });
});
