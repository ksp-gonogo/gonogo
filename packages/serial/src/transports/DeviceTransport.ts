// DeviceTransport — abstraction over the physical layer.
//
// Each DeviceInstance gets one transport. The SerialDeviceService owns
// transports, routes parsed input events up to subscribers, and pipes
// rendered frames back down via `write()`.
//
// Transports handle their own parsing so the service stays transport-agnostic.
// - WebSerialTransport runs the configured parser (currently `char-position`)
//   against each line read from the port.
// - VirtualTransport bypasses parsing — widgets and tests inject normalised
//   events directly.

import type { DeviceInput, DeviceType } from "../types";

export type TransportStatus = "disconnected" | "connected" | "error";

export type InputValue = boolean | number;

export interface InputEvent {
  inputId: string;
  value: InputValue;
}

/**
 * Emitted by the json-state parser path when a device reports structural
 * information — new inputs, an updated min/max, or a screen declaration.
 * The service upserts the owning DeviceType; `null` fields mean "no change
 * this tick" and are ignored.
 */
export interface SchemaUpdate {
  inputs?: DeviceInput[] | null;
  screen?: { type: string; [key: string]: unknown } | null;
  /**
   * Optional shape-derived type id. When present and different from the
   * instance's current typeId, the service ensures a DeviceType with this
   * id exists (creating one from `inputs` if needed) and re-points the
   * instance at it. Used by GamepadTransport so pads reporting the same
   * button/axis shape share one type instead of each connection breeding a
   * near-duplicate. Absent (falls back to the current type id) for
   * json-state devices, so their existing "one type per device" behaviour
   * is unaffected.
   */
  typeId?: string;
  /**
   * Physical-pad identity learned at this update (gamepad transport only).
   * The service persists it onto the owning DeviceInstance and, the first
   * time an instance ever learns one, preselects its label pack from it —
   * see SerialDeviceService.handleSchemaUpdate.
   */
  gamepadId?: string;
}

export interface DeviceTransport {
  /** Matches DeviceInstance.id. */
  readonly id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(data: string | Uint8Array): Promise<void>;
  onInput(cb: (event: InputEvent) => void): () => void;
  onStatus(cb: (status: TransportStatus, err?: unknown) => void): () => void;
  /**
   * Fires when a json-state device announces or updates its schema. Default
   * implementation (e.g. VirtualTransport) may never fire this — it's
   * harmless to subscribe anyway.
   */
  onSchema?(cb: (update: SchemaUpdate) => void): () => void;
  /**
   * Subscribe to raw lines arriving from the device, BEFORE parsing. Used
   * by the calibration wizard to display what the device is actually
   * sending so the user can drag-select offset/length. Optional: virtual
   * transports may not fire it.
   */
  onRawLine?(cb: (line: string) => void): () => void;
  /**
   * Swap the cached DeviceType — called by the service when an incoming
   * schema update changes the type's inputs or renderStyleConfig, so the
   * next tick's parser sees the new shape.
   */
  updateDeviceType?(type: DeviceType): void;
  readonly status: TransportStatus;
}
