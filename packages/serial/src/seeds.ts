import { KEYBOARD_INPUTS } from "./keyboardKeys";
import type { DeviceInstance, DeviceType } from "./types";

/**
 * Default device type seeded on first run so the virtual widget is usable
 * without the user manually creating a type. One 1D analog stick (`stick-x`)
 * plus six buttons labelled A–F.
 */
export const VIRTUAL_CONTROLLER_TYPE: DeviceType = {
  id: "virtual-controller",
  name: "Virtual Controller",
  parser: "char-position",
  renderStyleId: "text-buffer-168",
  inputs: [
    { id: "stick-x", name: "Stick X", kind: "analog", min: -100, max: 100 },
    { id: "a", name: "A", kind: "button" },
    { id: "b", name: "B", kind: "button" },
    { id: "c", name: "C", kind: "button" },
    { id: "d", name: "D", kind: "button" },
    { id: "e", name: "E", kind: "button" },
    { id: "f", name: "F", kind: "button" },
  ],
};

/** Default virtual instance seeded on first run. Per-screen. */
export function defaultVirtualDevice(): DeviceInstance {
  return {
    id: "virtual-controller-1",
    name: "Virtual Controller",
    typeId: VIRTUAL_CONTROLLER_TYPE.id,
    transport: "virtual",
  };
}

/**
 * Placeholder DeviceType a new gamepad device is created against before it
 * has ever paired with a physical pad, there's nothing to key a shape-
 * derived type id on yet (see gamepadShape.ts). `SerialDeviceService`
 * ensures this always exists (unconditionally, not just on a fresh
 * install; see `ensureGamepadPlaceholderType`), and `handleSchemaUpdate`
 * re-points the device instance at the real shape-derived type the moment
 * it connects for the first time. `authoredBy: "device"` keeps it out of
 * the Device Types tab (which hides device-authored types) so it never
 * looks like something the user should edit or remove.
 */
export const GAMEPAD_PLACEHOLDER_TYPE: DeviceType = {
  id: "gamepad-unconfigured",
  name: "Gamepad (unconfigured)",
  // Nominal: GamepadTransport parses frames itself; "json-state" is set
  // here only so the Device Type editor's existing device-authored branch
  // (read-only discovered-inputs list) applies, matching every other
  // device-authored type.
  parser: "json-state",
  inputs: [],
  authoredBy: "device",
};

/**
 * The keyboard's DeviceType. Code-defined and refreshed from this constant on
 * every service construction rather than merged with whatever localStorage
 * held, so a saved copy can never shadow the key table (see
 * `SerialDeviceService.ensureKeyboardDevice`). `authoredBy: "device"` keeps it
 * out of the Device Types tab: the keyboard is not something an operator
 * declares.
 */
export const KEYBOARD_TYPE: DeviceType = {
  id: "keyboard",
  name: "Keyboard",
  // Nominal, as for the gamepad placeholder: KeyboardTransport reads DOM key
  // events and never runs a parser. Every other device-authored type carries
  // "json-state" too.
  parser: "json-state",
  inputs: [...KEYBOARD_INPUTS],
  authoredBy: "device",
};

/**
 * The keyboard device every screen gets. Ensured on every service
 * construction, not seeded only on a fresh install: the operator is never
 * asked to create one, which is the entire point.
 */
export function defaultKeyboardDevice(): DeviceInstance {
  return {
    id: "keyboard",
    name: "Keyboard",
    typeId: KEYBOARD_TYPE.id,
    transport: "keyboard",
  };
}
