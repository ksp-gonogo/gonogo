// Label packs — vendor button naming for the gamepad transport. Keyed on
// `role`, never on `inputId` or raw index, so a pack can be swapped on an
// existing device without touching its bindings.
//
// Tables lifted (names only, re-keyed onto our `role` union) from
// LizardByte/gamepad-helper (MIT) — https://github.com/LizardByte/gamepad-helper
// `controllerMappings` tables. Vendored, not imported — see the module doc
// on GamepadTransport.ts for why gamepad-helper isn't taken as a dependency.
import type { GamepadRole } from "./gamepadRoles";
import { positionalName } from "./gamepadRoles";

export type LabelPack = "positional" | "xbox" | "playstation" | "nintendo";

type LabelTable = Record<GamepadRole, string>;

const XBOX_LABELS: LabelTable = {
  "face-south": "A",
  "face-east": "B",
  "face-west": "X",
  "face-north": "Y",
  "bumper-left": "LB",
  "bumper-right": "RB",
  "trigger-left": "LT",
  "trigger-right": "RT",
  select: "View",
  start: "Menu",
  "stick-left-press": "Left Stick",
  "stick-right-press": "Right Stick",
  "dpad-up": "D-Pad Up",
  "dpad-down": "D-Pad Down",
  "dpad-left": "D-Pad Left",
  "dpad-right": "D-Pad Right",
  home: "Xbox",
  "stick-left-x": "Left Stick X",
  "stick-left-y": "Left Stick Y",
  "stick-right-x": "Right Stick X",
  "stick-right-y": "Right Stick Y",
};

const PLAYSTATION_LABELS: LabelTable = {
  "face-south": "Cross",
  "face-east": "Circle",
  "face-west": "Square",
  "face-north": "Triangle",
  "bumper-left": "L1",
  "bumper-right": "R1",
  "trigger-left": "L2",
  "trigger-right": "R2",
  select: "Create",
  start: "Options",
  "stick-left-press": "L3",
  "stick-right-press": "R3",
  "dpad-up": "D-Pad Up",
  "dpad-down": "D-Pad Down",
  "dpad-left": "D-Pad Left",
  "dpad-right": "D-Pad Right",
  home: "PS",
  "stick-left-x": "Left Stick X",
  "stick-left-y": "Left Stick Y",
  "stick-right-x": "Right Stick X",
  "stick-right-y": "Right Stick Y",
};

// Nintendo swaps the face buttons relative to Xbox — `face-south` (the
// bottom button in the right cluster, physically) is `A` on Xbox but `B` on
// a Switch pad; `face-west`/`face-north` swap the same way. This is
// intentional, matching the real hardware layout — not a typo.
const NINTENDO_LABELS: LabelTable = {
  "face-south": "B",
  "face-east": "A",
  "face-west": "Y",
  "face-north": "X",
  "bumper-left": "L",
  "bumper-right": "R",
  "trigger-left": "ZL",
  "trigger-right": "ZR",
  select: "Minus",
  start: "Plus",
  "stick-left-press": "Left Stick",
  "stick-right-press": "Right Stick",
  "dpad-up": "D-Pad Up",
  "dpad-down": "D-Pad Down",
  "dpad-left": "D-Pad Left",
  "dpad-right": "D-Pad Right",
  home: "Home",
  "stick-left-x": "Left Stick X",
  "stick-left-y": "Left Stick Y",
  "stick-right-x": "Right Stick X",
  "stick-right-y": "Right Stick Y",
};

/**
 * Resolve the display name for a role under a label pack. `positional`
 * (the default, and the fallback for detection-unsure cases) uses the same
 * wording the auto-generated `DeviceInput.name` already carries — it means
 * "no vendor labelling", not "unlabelled".
 */
export function resolveGamepadLabel(
  role: GamepadRole,
  pack: LabelPack,
): string {
  switch (pack) {
    case "xbox":
      return XBOX_LABELS[role];
    case "playstation":
      return PLAYSTATION_LABELS[role];
    case "nintendo":
      return NINTENDO_LABELS[role];
    default:
      return positionalName(role);
  }
}
