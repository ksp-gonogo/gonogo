import { logger } from "@gonogo/logger";
import { getSerialRenderStyle } from "./registry";

const trace = logger.tag("serial:transport");
// Side-effect import: built-in render styles self-register on load so the
// service can resolve `text-buffer-168` without the caller opting in.
// Do not remove without first moving registration elsewhere.
import "./renderStyles/textBuffer";
import { defaultVirtualDevice, VIRTUAL_CONTROLLER_TYPE } from "./seeds";
import type {
  DeviceTransport,
  InputEvent,
  TransportStatus,
} from "./transports/DeviceTransport";
import { VirtualTransport } from "./transports/VirtualTransport";
import { WebSerialTransport } from "./transports/WebSerialTransport";
import type {
  DeviceInput,
  DeviceInstance,
  DeviceRenderStyle,
  DeviceType,
} from "./types";

const DEVICE_TYPES_KEY = "gonogo.serial.device-types";
const DEFAULT_RENDER_DEBOUNCE_MS = 100;

export type TransportFactory = (
  instance: DeviceInstance,
  deviceType: DeviceType,
) => DeviceTransport;

const defaultTransportFactory: TransportFactory = (instance, deviceType) => {
  if (instance.transport === "virtual")
    return new VirtualTransport(instance.id);
  return new WebSerialTransport({
    id: instance.id,
    deviceType,
    baudRate: instance.baudRate,
    filters: instance.filters,
  });
};

interface ManagedDevice {
  instance: DeviceInstance;
  deviceType: DeviceType;
  transport: DeviceTransport;
  unsubInput: () => void;
  unsubStatus: () => void;
  unsubSchema: (() => void) | null;
  frameState: Record<string, unknown>;
  renderTimer: ReturnType<typeof setTimeout> | null;
}

interface ServiceOptions {
  screenKey: string;
  transportFactory?: TransportFactory;
  renderDebounceMs?: number;
  storage?: Storage;
}

export class SerialDeviceService {
  private screenKey: string;
  private transportFactory: TransportFactory;
  private renderDebounceMs: number;
  private storage: Storage;

  private deviceTypes = new Map<string, DeviceType>();
  private managed = new Map<string, ManagedDevice>();
  /**
   * When true, the InputDispatcher skips dispatch on incoming events. Used
   * by the input-mapping UI's "press to bind" mode so the OLD binding for
   * a button doesn't fire while the user is trying to capture a NEW one.
   * onInput listeners still receive events — only the dispatcher path is
   * gated.
   */
  private captureMode = false;
  /**
   * `navigator.serial` event listeners installed for hot-plug awareness.
   * Stored so destroy() can detach them — important for tests that spin
   * up many services against a shared mock navigator.
   */
  private hotPlugConnectListener:
    | ((evt: SerialConnectionEvent) => void)
    | null = null;
  private hotPlugDisconnectListener:
    | ((evt: SerialConnectionEvent) => void)
    | null = null;
  /**
   * Saved web-serial devices for which autoReconnect found 2+ candidate
   * ports (same VID/PID, e.g. two identical foot-pedals plugged in). The
   * Devices menu surfaces these so the user picks the right one — without
   * the picker the device would silently stay disconnected.
   */
  private pendingChoices = new Map<string, SerialPort[]>();
  private pendingChoicesListeners = new Set<() => void>();

  private deviceTypeListeners = new Set<() => void>();
  private devicesListeners = new Set<() => void>();
  private inputListeners = new Set<
    (deviceId: string, event: InputEvent) => void
  >();
  private statusListeners = new Set<
    (deviceId: string, status: TransportStatus, err?: unknown) => void
  >();

  constructor(opts: ServiceOptions) {
    this.screenKey = opts.screenKey;
    this.transportFactory = opts.transportFactory ?? defaultTransportFactory;
    this.renderDebounceMs = opts.renderDebounceMs ?? DEFAULT_RENDER_DEBOUNCE_MS;
    this.storage = opts.storage ?? globalThis.localStorage;

    this.loadDeviceTypes();
    this.loadDevices();
    this.seedDefaultsIfEmpty();
    this.attachNavigatorListeners();
  }

  /**
   * Subscribe to `navigator.serial` connect/disconnect events so a controller
   * plugged in mid-session is auto-adopted (matching saved instances by
   * VID/PID), and so disconnect propagates to status listeners even if the
   * read-loop hasn't errored yet.
   *
   * No-op if `navigator.serial` is unavailable (Safari, tests without the
   * mock installed).
   */
  /**
   * Idempotent — calling twice doesn't double-attach. Public so the screen
   * lifecycle effect can re-attach after a StrictMode cleanup→setup cycle
   * (destroy detaches; without re-attach the navigator.serial 'connect'
   * event has no listener for the rest of the page lifetime).
   */
  attachNavigatorListeners(): void {
    if (this.hotPlugConnectListener) return;
    const serial = (globalThis as { navigator?: { serial?: Serial } }).navigator
      ?.serial;
    if (!serial?.addEventListener) {
      trace.debug("hot-plug listeners NOT installed (no navigator.serial)");
      return;
    }

    const onConnect = (evt: SerialConnectionEvent) => {
      const port = evt.target;
      const info = port?.getInfo?.();
      trace.debug("navigator.serial 'connect' fired", {
        hasTarget: !!port,
        vendorId: info?.usbVendorId,
        productId: info?.usbProductId,
      });
      if (!port) return;
      void this.tryAdoptPort(port);
    };
    const onDisconnect = (evt: SerialConnectionEvent) => {
      const port = evt.target;
      const info = port?.getInfo?.();
      trace.debug("navigator.serial 'disconnect' fired", {
        hasTarget: !!port,
        vendorId: info?.usbVendorId,
        productId: info?.usbProductId,
      });
      if (!port) return;
      this.handlePortDisconnect(port);
    };
    serial.addEventListener("connect", onConnect);
    serial.addEventListener("disconnect", onDisconnect);
    this.hotPlugConnectListener = onConnect;
    this.hotPlugDisconnectListener = onDisconnect;
    trace.debug("hot-plug listeners installed");
  }

  /** Counterpart to attachNavigatorListeners. Idempotent. */
  detachNavigatorListeners(): void {
    const serial = (globalThis as { navigator?: { serial?: Serial } }).navigator
      ?.serial;
    if (!serial?.removeEventListener) return;
    if (this.hotPlugConnectListener) {
      serial.removeEventListener("connect", this.hotPlugConnectListener);
      this.hotPlugConnectListener = null;
    }
    if (this.hotPlugDisconnectListener) {
      serial.removeEventListener("disconnect", this.hotPlugDisconnectListener);
      this.hotPlugDisconnectListener = null;
    }
  }

  /**
   * Try to adopt a single freshly-connected port. Picks the first managed
   * web-serial device that's currently disconnected and matches the port's
   * VID/PID. Quietly skips if nothing matches or the port is already in use.
   */
  private async tryAdoptPort(port: SerialPort): Promise<void> {
    const info = port?.getInfo?.();
    if (!info?.usbVendorId) {
      trace.debug("hot-plug skip — port has no VID/PID");
      return;
    }
    const candidates = Array.from(this.managed.values()).filter(
      (m) => m.instance.transport === "web-serial",
    );
    trace.debug("hot-plug evaluating candidates", {
      candidateCount: candidates.length,
      portVid: info.usbVendorId,
      portPid: info.usbProductId,
    });
    for (const managed of candidates) {
      if (managed.transport.status === "connected") {
        trace.debug("hot-plug skip — already connected", {
          deviceId: managed.instance.id,
        });
        continue;
      }
      // USB hubs sometimes emit a phantom 'connect' event during the
      // first moments of an unplug, before the disconnect propagates.
      // Skip if a connect is already in flight on this transport — the
      // existing one wins (or fails on its own terms).
      const inflight = (
        managed.transport as DeviceTransport & {
          isConnecting?: () => boolean;
        }
      ).isConnecting?.();
      if (inflight) {
        trace.debug("hot-plug skip — connect in flight", {
          deviceId: managed.instance.id,
        });
        continue;
      }
      const saved = managed.instance.portInfo;
      if (!saved?.vendorId) {
        trace.debug("hot-plug skip — no saved VID/PID", {
          deviceId: managed.instance.id,
        });
        continue;
      }
      if (
        saved.vendorId !== info.usbVendorId ||
        saved.productId !== info.usbProductId
      ) {
        continue;
      }

      const adopt = (
        managed.transport as DeviceTransport & {
          connect?: (opts?: { port?: SerialPort }) => Promise<void>;
        }
      ).connect;
      if (typeof adopt !== "function") continue;
      try {
        trace.debug("hot-plug adopting", { deviceId: managed.instance.id });
        await adopt.call(managed.transport, { port });
        this.capturePortInfo(managed);
        trace.debug("hot-plug adopt succeeded", {
          deviceId: managed.instance.id,
        });
      } catch (err) {
        logger.warn(
          `[SerialDeviceService] hot-plug adopt failed for ${managed.instance.id}`,
          { err: String(err) },
        );
      }
      // First match wins — refusing fan-out keeps two identical controllers
      // from racing to claim the same physical port.
      return;
    }
    trace.debug("hot-plug no matching candidate", {
      portVid: info.usbVendorId,
      portPid: info.usbProductId,
    });
  }

  /**
   * Mark any device whose port is the one being unplugged as disconnected.
   * The read-loop usually catches this via a stream error, but emitting the
   * status change deterministically here avoids a race where consumers see
   * the FAB tint go green before the error surfaces.
   */
  private handlePortDisconnect(port: SerialPort): void {
    const info = port?.getInfo?.();
    if (!info?.usbVendorId) return;
    for (const managed of this.managed.values()) {
      if (managed.instance.transport !== "web-serial") continue;
      const saved = managed.instance.portInfo;
      if (!saved?.vendorId) continue;
      if (
        saved.vendorId !== info.usbVendorId ||
        saved.productId !== info.usbProductId
      )
        continue;
      if (managed.transport.status === "disconnected") continue;
      void managed.transport.disconnect().catch(() => {});
    }
  }

  // -------------------------------------------------------------------------
  // Seeding
  // -------------------------------------------------------------------------

  private seedDefaultsIfEmpty(): void {
    if (this.deviceTypes.size === 0) {
      this.deviceTypes.set(VIRTUAL_CONTROLLER_TYPE.id, VIRTUAL_CONTROLLER_TYPE);
      this.saveDeviceTypes();
    }
    if (this.managed.size === 0) {
      const instance = defaultVirtualDevice();
      const type = this.deviceTypes.get(instance.typeId);
      if (type) {
        this.register(instance, type);
        this.saveDevices();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Device types (shared across screens on the same browser)
  // -------------------------------------------------------------------------

  getDeviceTypes(): DeviceType[] {
    return Array.from(this.deviceTypes.values());
  }

  getDeviceType(id: string): DeviceType | undefined {
    return this.deviceTypes.get(id);
  }

  upsertDeviceType(type: DeviceType): void {
    this.deviceTypes.set(type.id, type);
    this.saveDeviceTypes();
    this.emitDeviceTypesChange();
  }

  async removeDeviceType(id: string): Promise<void> {
    if (!this.deviceTypes.has(id)) return;
    // Remove instances that reference this type first so they don't dangle.
    for (const device of Array.from(this.managed.values())) {
      if (device.instance.typeId === id) {
        await this.removeDevice(device.instance.id);
      }
    }
    this.deviceTypes.delete(id);
    this.saveDeviceTypes();
    this.emitDeviceTypesChange();
  }

  onDeviceTypesChange(cb: () => void): () => void {
    this.deviceTypeListeners.add(cb);
    return () => {
      this.deviceTypeListeners.delete(cb);
    };
  }

  // -------------------------------------------------------------------------
  // Device instances (per-screen)
  // -------------------------------------------------------------------------

  getDevices(): DeviceInstance[] {
    return Array.from(this.managed.values()).map((m) => m.instance);
  }

  getDevice(id: string): DeviceInstance | undefined {
    return this.managed.get(id)?.instance;
  }

  addDevice(instance: DeviceInstance): void {
    if (this.managed.has(instance.id)) return;
    const deviceType = this.deviceTypes.get(instance.typeId);
    if (!deviceType) {
      throw new Error(`Unknown device type: ${instance.typeId}`);
    }
    this.register(instance, deviceType);
    this.saveDevices();
    this.emitDevicesChange();
  }

  updateDevice(id: string, updates: Partial<DeviceInstance>): void {
    const managed = this.managed.get(id);
    if (!managed) return;
    const nextInstance = { ...managed.instance, ...updates, id };
    const nextType =
      updates.typeId !== undefined
        ? this.deviceTypes.get(updates.typeId)
        : managed.deviceType;
    if (!nextType) throw new Error(`Unknown device type: ${updates.typeId}`);

    // If transport or type changed we must rebuild the transport.
    const rebuild =
      updates.transport !== undefined ||
      updates.typeId !== undefined ||
      updates.baudRate !== undefined ||
      updates.filters !== undefined;

    if (rebuild) {
      void this.teardown(managed);
      this.register(nextInstance, nextType);
    } else {
      managed.instance = nextInstance;
    }
    this.saveDevices();
    this.emitDevicesChange();
  }

  async removeDevice(id: string): Promise<void> {
    const managed = this.managed.get(id);
    if (!managed) return;
    const orphanedTypeId = managed.deviceType.id;
    const isDeviceAuthored = managed.deviceType.authoredBy === "device";
    await this.teardown(managed);
    this.managed.delete(id);
    this.saveDevices();
    this.emitDevicesChange();
    // Self-describing device types belong to a single instance — when that
    // instance goes, the type would otherwise dangle in the type editor with
    // no way to manage it. Drop it once the last referring device is gone.
    if (
      isDeviceAuthored &&
      this.deviceTypes.has(orphanedTypeId) &&
      !Array.from(this.managed.values()).some(
        (m) => m.instance.typeId === orphanedTypeId,
      )
    ) {
      this.deviceTypes.delete(orphanedTypeId);
      this.saveDeviceTypes();
      this.emitDeviceTypesChange();
    }
  }

  onDevicesChange(cb: () => void): () => void {
    this.devicesListeners.add(cb);
    return () => {
      this.devicesListeners.delete(cb);
    };
  }

  // -------------------------------------------------------------------------
  // Transport control
  // -------------------------------------------------------------------------

  /**
   * Connect a device. If a port is supplied (e.g. from a wizard that already
   * called navigator.serial.requestPort), it's passed straight to the
   * transport's connect — useful for one-shot pairing flows that want to
   * avoid prompting the user a second time.
   */
  async connect(deviceId: string, opts?: { port?: SerialPort }): Promise<void> {
    const managed = this.managed.get(deviceId);
    if (!managed) return;
    const connect = (
      managed.transport as DeviceTransport & {
        connect?: (opts?: { port?: SerialPort }) => Promise<void>;
      }
    ).connect;
    if (typeof connect !== "function") return;
    await connect.call(managed.transport, opts);
    this.capturePortInfo(managed);
  }

  /**
   * Try to reopen previously-authorised Web Serial ports without prompting
   * the user. For each saved web-serial device, match the navigator-held
   * port list by VID/PID; if we find exactly one match and the device
   * isn't already connected, adopt it. Ambiguous matches (two identical
   * devices plugged in) are left alone so the user can pick explicitly.
   *
   * Safe to call on any screen — no-op if the browser doesn't expose
   * `navigator.serial.getPorts`.
   */
  async autoReconnect(): Promise<void> {
    const serial = (
      globalThis as {
        navigator?: {
          serial?: {
            getPorts?: () => Promise<SerialPort[]>;
          };
        };
      }
    ).navigator?.serial;
    if (!serial?.getPorts) return;
    let ports: SerialPort[];
    try {
      ports = await serial.getPorts();
    } catch (err) {
      logger.warn("[SerialDeviceService] getPorts failed", {
        err: String(err),
      });
      return;
    }

    for (const managed of this.managed.values()) {
      if (managed.instance.transport !== "web-serial") continue;
      if (managed.transport.status === "connected") continue;
      const info = managed.instance.portInfo;
      if (!info?.vendorId) continue;

      const candidates = ports.filter((port) => {
        const pInfo = port.getInfo();
        return (
          pInfo.usbVendorId === info.vendorId &&
          pInfo.usbProductId === info.productId
        );
      });
      if (candidates.length === 0) continue;
      if (candidates.length > 1) {
        // Same VID/PID on two ports — can't pick automatically. Park them
        // for the UI to resolve via resolvePendingChoice().
        this.pendingChoices.set(managed.instance.id, candidates);
        this.emitPendingChoicesChange();
        continue;
      }

      const adopt = (
        managed.transport as DeviceTransport & {
          connect?: (opts?: { port?: SerialPort }) => Promise<void>;
        }
      ).connect;
      if (typeof adopt !== "function") continue;
      try {
        await adopt.call(managed.transport, { port: candidates[0] });
        this.capturePortInfo(managed);
      } catch (err) {
        logger.warn(
          `[SerialDeviceService] auto-reconnect failed for ${managed.instance.id}`,
          { err: String(err) },
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pending-choice resolution (ambiguous autoReconnect matches)
  // -------------------------------------------------------------------------

  /** Snapshot of saved devices that need the user to disambiguate ports. */
  getPendingChoices(): ReadonlyMap<string, readonly SerialPort[]> {
    return this.pendingChoices;
  }

  onPendingChoicesChange(cb: () => void): () => void {
    this.pendingChoicesListeners.add(cb);
    return () => {
      this.pendingChoicesListeners.delete(cb);
    };
  }

  /**
   * Adopt a specific port from the pending-choice list for a device.
   * No-op if the device or index is out of range. On success the entry is
   * cleared and listeners are notified.
   */
  async resolvePendingChoice(
    deviceId: string,
    portIndex: number,
  ): Promise<void> {
    const choices = this.pendingChoices.get(deviceId);
    if (!choices) return;
    const port = choices[portIndex];
    if (!port) return;
    const managed = this.managed.get(deviceId);
    if (!managed) return;
    const adopt = (
      managed.transport as DeviceTransport & {
        connect?: (opts?: { port?: SerialPort }) => Promise<void>;
      }
    ).connect;
    if (typeof adopt !== "function") return;
    try {
      await adopt.call(managed.transport, { port });
      this.capturePortInfo(managed);
      this.pendingChoices.delete(deviceId);
      this.emitPendingChoicesChange();
    } catch (err) {
      logger.warn(
        `[SerialDeviceService] resolvePendingChoice failed for ${deviceId}`,
        { err: String(err) },
      );
    }
  }

  private emitPendingChoicesChange(): void {
    this.pendingChoicesListeners.forEach((cb) => {
      cb();
    });
  }

  private capturePortInfo(managed: ManagedDevice): void {
    // The connect that triggered this could have started before the device
    // was removed (or before destroy ran in a StrictMode cycle). If the
    // managed entry isn't current any more, don't act — saveDevices()
    // would otherwise persist a list that doesn't include the orphaned
    // device, which can wipe a perfectly valid localStorage entry.
    if (this.managed.get(managed.instance.id) !== managed) return;
    const transport = managed.transport as DeviceTransport & {
      getPortInfo?: () => { vendorId?: number; productId?: number } | null;
    };
    const info = transport.getPortInfo?.();
    if (!info?.vendorId) return;
    const prev = managed.instance.portInfo;
    if (prev?.vendorId === info.vendorId && prev.productId === info.productId)
      return;
    managed.instance = { ...managed.instance, portInfo: info };
    this.saveDevices();
    this.emitDevicesChange();
  }

  async disconnect(deviceId: string): Promise<void> {
    const managed = this.managed.get(deviceId);
    if (!managed) return;
    await managed.transport.disconnect();
  }

  getStatus(deviceId: string): TransportStatus {
    return this.managed.get(deviceId)?.transport.status ?? "disconnected";
  }

  getTransport(deviceId: string): DeviceTransport | undefined {
    return this.managed.get(deviceId)?.transport;
  }

  setCaptureMode(on: boolean): void {
    this.captureMode = on;
  }

  isCaptureMode(): boolean {
    return this.captureMode;
  }

  onInput(cb: (deviceId: string, event: InputEvent) => void): () => void {
    this.inputListeners.add(cb);
    return () => {
      this.inputListeners.delete(cb);
    };
  }

  onStatusChange(
    cb: (deviceId: string, status: TransportStatus, err?: unknown) => void,
  ): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  // -------------------------------------------------------------------------
  // Action return values → debounced render → transport.write()
  // -------------------------------------------------------------------------

  /**
   * Called by the InputDispatcher whenever an action handler returns a value
   * for a given device. The latest value per-key is merged into the device's
   * frame state and a render is scheduled.
   */
  recordActionReturn(deviceId: string, returned: unknown): void {
    if (returned === null || returned === undefined) return;
    if (typeof returned !== "object") return;
    const managed = this.managed.get(deviceId);
    if (!managed) return;
    Object.assign(managed.frameState, returned as Record<string, unknown>);
    this.scheduleRender(managed);
  }

  /** Force-flush any pending renders (used by destroy + tests). */
  flushRender(deviceId: string): void {
    const managed = this.managed.get(deviceId);
    if (!managed) return;
    if (managed.renderTimer !== null) {
      clearTimeout(managed.renderTimer);
      managed.renderTimer = null;
    }
    this.renderNow(managed);
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /**
   * Release ports + detach navigator listeners. Used by the screen
   * lifecycle effect cleanup.
   *
   * Deliberately preserves the `managed` map AND the input/status/schema
   * forwards subscribed during register(). React StrictMode dev's
   * cleanup→setup cycle would otherwise:
   *   - clear managed (causing in-flight capturePortInfo callbacks to run
   *     saveDevices() with an empty list, wiping localStorage), and
   *   - tear down the transport→service forwards (so even after autoReconnect
   *     re-opened the port, no events would surface to widgets).
   *
   * Only the transient transport state — open ports, render timers — is
   * torn down. Calling autoReconnect afterwards reopens the same transports
   * cleanly via the defensive force-close path in WebSerialTransport.connect.
   */
  async destroy(): Promise<void> {
    this.detachNavigatorListeners();
    for (const managed of Array.from(this.managed.values())) {
      if (managed.renderTimer !== null) {
        clearTimeout(managed.renderTimer);
        managed.renderTimer = null;
      }
      try {
        await managed.transport.disconnect();
      } catch (err) {
        logger.warn(
          `[SerialDeviceService] transport.disconnect failed for ${managed.instance.id}`,
          { err: String(err) },
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private register(instance: DeviceInstance, deviceType: DeviceType): void {
    const transport = this.transportFactory(instance, deviceType);
    const unsubInput = transport.onInput((event) => {
      this.inputListeners.forEach((cb) => {
        cb(instance.id, event);
      });
    });
    const unsubStatus = transport.onStatus((status, err) => {
      this.statusListeners.forEach((cb) => {
        cb(instance.id, status, err);
      });
    });
    const unsubSchema = transport.onSchema
      ? transport.onSchema((update) => {
          this.handleSchemaUpdate(instance.id, update);
        })
      : null;
    this.managed.set(instance.id, {
      instance,
      deviceType,
      transport,
      unsubInput,
      unsubStatus,
      unsubSchema,
      frameState: {},
      renderTimer: null,
    });
  }

  /**
   * Apply a device-announced schema update to the managed type: merges
   * newly-reported inputs, updates renderStyleConfig for txt screens,
   * marks the type as device-authored, and swaps the transport's cached
   * reference so the next tick parses against the new shape.
   */
  private handleSchemaUpdate(
    deviceId: string,
    update: {
      inputs?: DeviceInput[] | null;
      screen?: { type: string; [key: string]: unknown } | null;
    },
  ): void {
    const managed = this.managed.get(deviceId);
    if (!managed) return;
    const current = managed.deviceType;
    let changed = false;
    const next: DeviceType = { ...current, authoredBy: "device" };
    if (current.authoredBy !== "device") changed = true;

    if (update.inputs) {
      next.inputs = update.inputs;
      changed = true;
    }
    if (update.screen) {
      const { type: screenType, ...rest } = update.screen;
      if (screenType === "txt") {
        next.renderStyleId = "text-buffer";
        next.renderStyleConfig = rest;
        changed = true;
      }
    }
    if (!changed) return;

    this.deviceTypes.set(next.id, next);
    managed.deviceType = next;
    managed.transport.updateDeviceType?.(next);
    this.saveDeviceTypes();
    this.emitDeviceTypesChange();
  }

  private async teardown(managed: ManagedDevice): Promise<void> {
    managed.unsubInput();
    managed.unsubStatus();
    managed.unsubSchema?.();
    if (managed.renderTimer !== null) {
      clearTimeout(managed.renderTimer);
      managed.renderTimer = null;
    }
    try {
      await managed.transport.disconnect();
    } catch (err) {
      logger.warn(
        `[SerialDeviceService] transport.disconnect failed for ${managed.instance.id}`,
        { err: String(err) },
      );
    }
  }

  private scheduleRender(managed: ManagedDevice): void {
    if (managed.renderTimer !== null) clearTimeout(managed.renderTimer);
    managed.renderTimer = setTimeout(() => {
      managed.renderTimer = null;
      this.renderNow(managed);
    }, this.renderDebounceMs);
  }

  private renderNow(managed: ManagedDevice): void {
    const styleId = managed.deviceType.renderStyleId;
    if (!styleId) return;
    const style: DeviceRenderStyle | undefined = getSerialRenderStyle(styleId);
    if (!style) return;
    try {
      const frame = style.render(
        managed.frameState,
        managed.deviceType.renderStyleConfig,
      );
      void managed.transport.write(frame);
    } catch (err) {
      logger.error(
        `[SerialDeviceService] render failed for ${managed.instance.id}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private devicesKey(): string {
    return `gonogo.serial.devices.${this.screenKey}`;
  }

  private loadDeviceTypes(): void {
    try {
      const raw = this.storage.getItem(DEVICE_TYPES_KEY);
      if (!raw) return;
      const list = JSON.parse(raw) as DeviceType[];
      for (const t of list) this.deviceTypes.set(t.id, t);
    } catch (err) {
      logger.warn("[SerialDeviceService] failed to load device types", {
        err: String(err),
      });
    }
  }

  private saveDeviceTypes(): void {
    try {
      this.storage.setItem(
        DEVICE_TYPES_KEY,
        JSON.stringify(Array.from(this.deviceTypes.values())),
      );
    } catch {
      // ignore quota/permission errors — in-memory state is authoritative
    }
  }

  private loadDevices(): void {
    try {
      const raw = this.storage.getItem(this.devicesKey());
      if (!raw) return;
      const list = JSON.parse(raw) as DeviceInstance[];
      let droppedAny = false;
      for (const inst of list) {
        const type = this.deviceTypes.get(inst.typeId);
        if (!type) {
          logger.warn(
            `[SerialDeviceService] dropping device ${inst.id} — unknown type ${inst.typeId}`,
          );
          droppedAny = true;
          continue;
        }
        this.register(inst, type);
      }
      // Self-heal: rewrite localStorage without the orphans so we don't
      // log the same warning every refresh. Persisting the in-memory list
      // is enough — the dropped entries are gone from memory already.
      if (droppedAny) this.saveDevices();
    } catch (err) {
      logger.warn("[SerialDeviceService] failed to load devices", {
        err: String(err),
      });
    }
  }

  private saveDevices(): void {
    try {
      this.storage.setItem(
        this.devicesKey(),
        JSON.stringify(this.getDevices()),
      );
    } catch {
      // ignore
    }
  }

  private emitDeviceTypesChange(): void {
    this.deviceTypeListeners.forEach((cb) => {
      cb();
    });
  }

  private emitDevicesChange(): void {
    this.devicesListeners.forEach((cb) => {
      cb();
    });
  }
}
