// RealFuels uplink client identity. One declaration per client bundle: the
// augment this package registers stamps this handle as `owner`, so the widget
// picker's mod search tags derive "realfuels" automatically, and the
// render/docs tool knows which client the bundle's registrations belong to.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// This declaration is the source of the client's version, not the manifest: `gonogo-uplink.json` is generated FROM it, so it cannot supply the number that goes into it. Keep it equal to `package.json`'s.
const UPLINK_VERSION = "0.0.1";

// "realfuels" is the load-bearing part, matching the Domain gate the
// `realfuels.available` presence primitive binds.
export const REALFUELS = defineUplinkClient({
  id: "realfuels",
  version: UPLINK_VERSION,
  name: "RealFuels",
  description:
    "Reports per-engine RealFuels limits: ignitions remaining, ullage " +
    "stability and pressure feed, plus cryogenic boiloff.",
});
