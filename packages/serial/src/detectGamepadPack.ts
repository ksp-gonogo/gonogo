// Preselect a label pack from `gamepad.id` — a hint, never authority. Used
// exactly once, when an instance first pairs with a physical pad (see
// SerialDeviceService.handleSchemaUpdate); the user can always override,
// and an explicit choice is never re-detected over.
//
// `gamepad.id` is the only signal the Gamepad API exposes (the spec
// deliberately withholds structured vendor/product/name fields — see
// w3c/gamepad issue 199, open and stalled), so detection has to read an
// unstructured, browser-specific string. Ordered from most to least
// reliable; falls through to `positional` when nothing matches.
import type { LabelPack } from "./gamepadLabels";

// Vendor IDs as they appear in a `vendorId-productId-name` style `id`
// string on Chrome/Linux/macOS (e.g. "054c-0ce6-DualSense Wireless
// Controller"). Firefox does NOT zero-pad these — "810-3-USB Gamepad" is a
// real, valid id — so the pattern below matches 1-4 hex digits, not
// exactly 4; a `{4}` quantifier would silently miss the unpadded form.
const VENDOR_ID_PATTERN = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i;

const SONY_VENDOR_ID = "054c";
const MICROSOFT_VENDOR_ID = "045e";
const NINTENDO_VENDOR_ID = "057e";

export function detectGamepadPack(id: string): LabelPack {
  const vendorMatch = VENDOR_ID_PATTERN.exec(id);
  if (vendorMatch) {
    const vendorId = vendorMatch[1].toLowerCase().padStart(4, "0");
    switch (vendorId) {
      case SONY_VENDOR_ID:
        return "playstation";
      case MICROSOFT_VENDOR_ID:
        return "xbox";
      case NINTENDO_VENDOR_ID:
        return "nintendo";
      default:
        break;
    }
  }

  // No vendor id (Safari's `id` is a plain product name; some `id`s carry
  // a name without leading vendor/product hex at all) — fall back to a
  // substring match against known product names.
  const lower = id.toLowerCase();
  if (lower.includes("dualsense") || lower.includes("dualshock")) {
    return "playstation";
  }
  if (lower.includes("xbox")) {
    return "xbox";
  }
  if (lower.includes("pro controller") || lower.includes("joy-con")) {
    return "nintendo";
  }

  // XInput is Microsoft's Xbox controller API — an `id` mentioning it (with
  // or without a name attached) is a reliable signal even with no other
  // clue, since Chrome/Windows XInput pads always report through it.
  if (lower.includes("xinput")) {
    return "xbox";
  }

  return "positional";
}
