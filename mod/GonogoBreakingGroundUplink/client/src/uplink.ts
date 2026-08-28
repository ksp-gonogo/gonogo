// Uplink client identity. One
// declaration per client bundle: every widget this package registers
// stamps this handle as `owner`, so the widget picker's mod search tags
// (effectiveSearchTags) derive "breakingGround" automatically instead of
// relying on a per-widget field someone has to remember to set.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// This declaration is the source of the client's version, not the manifest: `gonogo-uplink.json` is generated FROM it, so it cannot supply the number that goes into it. Keep it equal to `package.json`'s.
const UPLINK_VERSION = "0.0.1";

export const BREAKING_GROUND = defineUplinkClient({
  id: "breakingGround",
  version: UPLINK_VERSION,
  name: "Breaking Ground",
  description:
    "Drives Breaking Ground robotic joints and rotors from the console, and reports " +
    "deployed surface bases on every body while you fly something else.",
});
