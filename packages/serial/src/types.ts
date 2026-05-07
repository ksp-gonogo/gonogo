// Serial input platform — shared types (core)
//
// DeviceTypes and DeviceInstances are user-data (persisted to localStorage
// via the SerialDeviceService in @gonogo/app). RenderStyles are code-defined
// and live in a singleton registry here (see ./registry.ts).

export type DeviceInputKind = "button" | "analog";

/**
 * Shape applied to an analog input AFTER it's been normalised to -1..1 using
 * `{ min, max }`. `linear` is pass-through; `squared` (sign-preserving) and
 * `cubic` give finer control near centre — handy for translation/rotation
 * sticks where small flying corrections need precision but the full range
 * still has to saturate.
 */
export type AnalogCurve = "linear" | "squared" | "cubic";

/**
 * One named input on a DeviceType. For the built-in `char-position` parser,
 * `offset` + `length` describe where in the incoming line this input's value
 * lives. Analog inputs additionally declare `{ min, max }` so raw integers
 * can be normalised to `-1..1`.
 *
 * `deadzone` and `curve` are post-normalisation shaping for analog inputs.
 * Both default to no-op (deadzone 0, curve linear) so existing types are
 * unchanged.
 */
export interface DeviceInput {
  id: string;
  name: string;
  kind: DeviceInputKind;
  offset?: number;
  length?: number;
  min?: number;
  max?: number;
  /**
   * Magnitude (0..1) below which the analog value is snapped to zero. Values
   * outside the deadzone are rescaled so the response curve still reaches
   * ±1 — without rescaling, a deadzone of 0.1 would cap usable travel at
   * 0.9. Ignored for buttons.
   */
  deadzone?: number;
  /** Response curve applied after deadzone. Default `linear`. */
  curve?: AnalogCurve;
}

export type DeviceParserId = "char-position" | "json-state";

/**
 * Who owns the type's inputs list? User-authored types are edited through
 * the Device Type editor UI. Device-authored types are populated at connect
 * time from a device's self-reported schema (json-state parser) and are
 * treated as read-only in the editor — the device is the source of truth.
 */
export type DeviceTypeAuthor = "user" | "device";

export interface DeviceType {
  id: string;
  name: string;
  inputs: DeviceInput[];
  /** Parser used to convert inbound lines to typed input events. */
  parser: DeviceParserId;
  /** Optional render style id — drives output back to the device. */
  renderStyleId?: string;
  /**
   * Render-style configuration, forwarded to the style's `render(merged, config)`.
   * e.g. the `text-buffer` style reads `{ w, h }` so the same style can drive
   * a 21×8, 40×4, or 8×2 character display. Device-authored types populate
   * this from their `screen` block.
   */
  renderStyleConfig?: Record<string, unknown>;
  /** Defaults to "user" for backward compatibility with existing saved types. */
  authoredBy?: DeviceTypeAuthor;
}

export type DeviceTransportKind = "web-serial" | "virtual";

/**
 * A user-registered physical or virtual device on a given screen. `transport`
 * selects how the SerialDeviceService opens the device; web-serial options
 * are only relevant when `transport === "web-serial"`.
 */
export interface DeviceInstance {
  id: string;
  name: string;
  typeId: string;
  transport: DeviceTransportKind;
  baudRate?: number;
  filters?: SerialPortFilter[];
  portInfo?: { vendorId?: number; productId?: number };
}

/**
 * Code-registered render style. The service calls `render(merged)` with a
 * debounced snapshot of all action-return-values for the device and pipes
 * the result into the transport's `write()`.
 */
export interface DeviceRenderStyle {
  id: string;
  name: string;
  description?: string;
  /**
   * `config` is forwarded from `DeviceType.renderStyleConfig` so one style
   * can parameterise its output (e.g. text-buffer takes `{w, h}`). Styles
   * that don't need config can ignore the second argument.
   */
  render(
    merged: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): string | Uint8Array;
}

// ---------------------------------------------------------------------------
// Minimal Web Serial shims — avoid pulling a full `dom-serial` dep for a
// single interface. These match the Web Serial spec subset we actually need.
// ---------------------------------------------------------------------------

export interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}
