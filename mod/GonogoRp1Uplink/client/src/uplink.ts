// Uplink client identity. One declaration per client bundle: every widget and
// augment this package registers stamps this handle as `owner`, so the widget
// picker's mod search tags derive "rp1" automatically rather than relying on a
// per-widget field somebody has to remember to set.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// The source of the client's version, not the manifest: `gonogo-uplink.json` is
// generated FROM it, so it cannot supply the number that goes into it. Keep it
// equal to `package.json`'s.
const UPLINK_VERSION = "0.0.0-dev";

export const RP1 = defineUplinkClient({
  id: "rp1",
  version: UPLINK_VERSION,
  name: "RP-1",
});
