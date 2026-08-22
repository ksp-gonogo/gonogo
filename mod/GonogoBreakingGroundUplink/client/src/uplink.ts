// Uplink client identity (Uplink Client Contract design §3.1). One
// declaration per client bundle: every widget this package registers
// stamps this handle as `owner`, so the widget picker's mod search tags
// (effectiveSearchTags) derive "breakingGround" automatically instead of
// relying on a per-widget field someone has to remember to set.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// This declaration is the source of the client's version, not the manifest: `gonogo-uplink.json` is generated FROM it, so it cannot supply the number that goes into it. Keep it equal to `package.json`'s.
const UPLINK_VERSION = "0.0.0-dev";

export const BREAKING_GROUND = defineUplinkClient({
  id: "breakingGround",
  version: UPLINK_VERSION,
  name: "Breaking Ground",
});
