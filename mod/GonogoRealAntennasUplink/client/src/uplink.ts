// RealAntennas uplink client identity (Uplink Client Contract design §3.1). The
// contribution this package registers stamps this handle as `owner`, and its
// `registerContribution` resolves `ContributionEntry` against the SDK's own
// contribution registry (where `comm-signal.hop-rates` is declared), which is
// the path every uplink-authored contribution takes. The RA augments still use
// the raw `registerAugment` from core; only the contribution needs the SDK-typed
// handle.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// TODO(version): Phase 2 build-injects this from gonogo-uplink.json (spec §5).
const UPLINK_VERSION = "0.0.0-dev";

// "RealAntennas" is the human label; the "realantennas" id is the load-bearing
// part, matching the Domain gate the augments' `requires: "realantennas"` binds.
export const REALANTENNAS = defineUplinkClient({
  id: "realantennas",
  version: UPLINK_VERSION,
  name: "RealAntennas",
});
