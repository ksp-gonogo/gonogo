// RealAntennas uplink client identity. The
// contribution this package registers stamps this handle as `owner`, and its
// `registerContribution` resolves `ContributionEntry` against the SDK's own
// contribution registry (where `comm-signal.hop-rates` is declared), which is
// the path every uplink-authored contribution takes. The RA augments still use
// the raw `registerAugment` from core; only the contribution needs the SDK-typed
// handle.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// This declaration is the source of the client's version, not the manifest: `gonogo-uplink.json` is generated FROM it, so it cannot supply the number that goes into it. Keep it equal to `package.json`'s.
const UPLINK_VERSION = "0.0.1";

// "RealAntennas" is the human label; the "realantennas" id is the load-bearing
// part, matching the Domain gate the augments' `requires: "realantennas"` binds.
export const REALANTENNAS = defineUplinkClient({
  id: "realantennas",
  version: UPLINK_VERSION,
  name: "RealAntennas",
});
