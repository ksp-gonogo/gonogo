// Shared "how should this input read on screen" resolution, used by every
// UI surface that lists device inputs (InputMappingTab, InputTester). Keeps
// the pack+role+fallback logic in one place instead of three call sites
// each re-deriving it slightly differently.
import { getGamepadGlyph } from "./gamepadGlyphs";
import { resolveGamepadLabel } from "./gamepadLabels";
import type { DeviceInput, DeviceInstance } from "./types";

export interface GamepadInputDisplay {
  name: string;
  /** Vendored glyph markup, or undefined when the pack/role has none (the
   *  `positional` pack, or a role with no art) — render name-only. */
  glyph?: string;
}

/**
 * Resolve the display name + glyph for one input, honouring the owning
 * device's label pack. Falls back to the input's own (generic or
 * user-authored) name with no glyph for: non-gamepad devices, an input
 * with no assigned `role` (unrecognised buttons, or any input at all on a
 * non-standard pad), or a role the chosen pack has no art for. Never
 * guesses a label.
 */
export function describeGamepadInput(
  device: Pick<DeviceInstance, "transport" | "labelPack">,
  input: Pick<DeviceInput, "name" | "role">,
): GamepadInputDisplay {
  if (device.transport !== "gamepad" || !input.role) {
    return { name: input.name };
  }
  const pack = device.labelPack ?? "positional";
  return {
    name: resolveGamepadLabel(input.role, pack),
    glyph: getGamepadGlyph(pack, input.role),
  };
}
