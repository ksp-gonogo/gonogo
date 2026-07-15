// The canonical gamepad "role" vocabulary — the physical position a button
// or axis occupies, independent of any vendor's letters/icons for it (see
// the design note in the Wednesday Work gamepad-transport spec: the W3C
// Gamepad spec itself defines button 0 as "Bottom button in right cluster",
// never "A" or "Cross" — the vocabulary is deliberately positional, and
// Nintendo's A/B swap is exactly why: `face-south` is the same physical
// position on every pad, but a different letter per vendor).
//
// `role` is display metadata only. It is assigned automatically under the
// standard mapping (see gamepadShape.ts) and is never derived from, or used
// to derive, `inputId` (the binding key), `kind`, or `polarity`.
export const GAMEPAD_ROLES = [
  "face-south",
  "face-east",
  "face-west",
  "face-north",
  "bumper-left",
  "bumper-right",
  "trigger-left",
  "trigger-right",
  "select",
  "start",
  "stick-left-press",
  "stick-right-press",
  "dpad-up",
  "dpad-down",
  "dpad-left",
  "dpad-right",
  "home",
  "stick-left-x",
  "stick-left-y",
  "stick-right-x",
  "stick-right-y",
] as const;

export type GamepadRole = (typeof GAMEPAD_ROLES)[number];

/**
 * Standard-mapping button index → role, indices 0-16 (the W3C "standard
 * gamepad" button layout). Index 17+ (e.g. a DualSense's touchpad click) has
 * no canonical role — it stays bindable with a generic name, never a
 * guessed one.
 */
export const STANDARD_BUTTON_ROLES: readonly GamepadRole[] = [
  "face-south",
  "face-east",
  "face-west",
  "face-north",
  "bumper-left",
  "bumper-right",
  "trigger-left",
  "trigger-right",
  "select",
  "start",
  "stick-left-press",
  "stick-right-press",
  "dpad-up",
  "dpad-down",
  "dpad-left",
  "dpad-right",
  "home",
];

/** Standard-mapping axis index → role, indices 0-3. */
export const STANDARD_AXIS_ROLES: readonly GamepadRole[] = [
  "stick-left-x",
  "stick-left-y",
  "stick-right-x",
  "stick-right-y",
];

/**
 * Human-readable positional wording used as the generated `DeviceInput.name`
 * default under the standard mapping (e.g. "Face South"), and as the
 * `positional` label pack's display text — the same words either way, since
 * `positional` means "no vendor labelling", not "no labelling at all".
 */
export function positionalName(role: GamepadRole): string {
  return role
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
