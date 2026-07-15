// Pure functions that turn a live Gamepad's reported shape (button/axis
// counts + W3C `mapping`) into a device-authored DeviceType — the
// GamepadTransport calls these at connect and hands the result to the
// service via `onSchema`; nothing here touches the transport or the service.
import {
  positionalName,
  STANDARD_AXIS_ROLES,
  STANDARD_BUTTON_ROLES,
} from "./gamepadRoles";
import type { DeviceInput } from "./types";

/**
 * Buttons that carry continuous pressure under the standard mapping —
 * Chromium's standard-gamepad mapper routes indices 6/7 (the triggers)
 * through `AxisToButton`, so `.value` is genuinely analog there. Every
 * other standard-mapping button is a true digital press.
 */
const STANDARD_ANALOG_BUTTON_INDICES = new Set([6, 7]);

/**
 * Deterministic type id from shape alone, so pads that report the same
 * button/axis counts and mapping share one DeviceType instead of each
 * connection breeding a near-duplicate. NOT based on `gamepad.id` — two
 * different physical pads of the same shape (e.g. two 17-button/4-axis
 * standard pads) are meant to share a type.
 */
export function gamepadTypeId(
  buttonCount: number,
  axisCount: number,
  mapping: string,
): string {
  const kind = mapping === "standard" ? "standard" : "nonstandard";
  return `gamepad-${kind}-${buttonCount}b-${axisCount}a`;
}

/**
 * Build the DeviceInput list for a live pad's shape.
 *
 * Two paths, decided by `mapping`:
 *  - `"standard"`: roles auto-assigned from the canonical table (buttons
 *    0-16, axes 0-3); buttons 6/7 are analog+unipolar (the triggers); any
 *    button beyond 16 (e.g. a DualSense's touchpad click at 17) gets no
 *    role and a generic name, but stays bindable.
 *  - anything else (`""`, or an unrecognised string): NO roles assigned at
 *    all. Every button defaults to `kind: "button"`, every axis to
 *    `kind: "analog"` + `polarity: "bipolar"` — deliberately not guessed,
 *    since a non-standard pad's real layout (e.g. whether its triggers are
 *    buttons or axes) is unknown from the browser alone.
 *
 * `role` never implies `kind`/`polarity` here, by design — see the spec's
 * Risks section on why those stay independently settable.
 */
export function buildGamepadInputs(
  buttonCount: number,
  axisCount: number,
  mapping: string,
): DeviceInput[] {
  const isStandard = mapping === "standard";
  const inputs: DeviceInput[] = [];

  for (let i = 0; i < buttonCount; i++) {
    const role = isStandard ? STANDARD_BUTTON_ROLES[i] : undefined;
    const isAnalog = isStandard && STANDARD_ANALOG_BUTTON_INDICES.has(i);
    inputs.push({
      id: `button-${i}`,
      name: role ? positionalName(role) : `Button ${i}`,
      kind: isAnalog ? "analog" : "button",
      ...(isAnalog ? { polarity: "unipolar" as const } : {}),
      ...(role ? { role } : {}),
    });
  }

  for (let i = 0; i < axisCount; i++) {
    const role = isStandard ? STANDARD_AXIS_ROLES[i] : undefined;
    inputs.push({
      id: `axis-${i}`,
      name: role ? positionalName(role) : `Axis ${i}`,
      kind: "analog",
      polarity: "bipolar",
      ...(role ? { role } : {}),
    });
  }

  return inputs;
}
