// Avionics uplink client identity. One declaration per client bundle: the
// widget this package registers stamps this handle as `owner`, so the widget
// picker's mod search tags (effectiveSearchTags) derive "avionics"
// automatically instead of relying on a per-widget field someone has to
// remember to set. It is also what tells the render/docs tool which client the
// bundle's registrations belong to.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// This declaration is the source of the client's version, not the manifest: `gonogo-uplink.json` is generated FROM it, so it cannot supply the number that goes into it. Keep it equal to `package.json`'s.
const UPLINK_VERSION = "0.0.1";

// "avionics" is the load-bearing part, matching the Domain gate the
// `avionics.available` presence primitive binds.
export const AVIONICS = defineUplinkClient({
  id: "avionics",
  version: UPLINK_VERSION,
  name: "Avionics",
  description:
    "Reports the active RP-1 avionics unit's tonnage limit against the " +
    "vessel's mass.",
});
