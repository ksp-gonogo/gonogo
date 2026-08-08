// Uplink client identity (Uplink Client Contract design §3.1). One declaration
// per client bundle: every widget/processor/contribution this package registers
// stamps this handle as `owner`, so the widget picker's mod search tags derive
// "kerbalism" automatically and the Processor/contribution ids namespace under
// it, instead of relying on a per-registration field someone has to remember.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// TODO(version): Phase 2 build-injects this from gonogo-uplink.json (spec §5).
const UPLINK_VERSION = "0.0.0-dev";

// "Kerbalism" (the mod's own capitalisation) is the human label; the "kerbalism"
// id is the load-bearing part, it is what every owner-stamp uses.
export const KERBALISM = defineUplinkClient({
  id: "kerbalism",
  version: UPLINK_VERSION,
  name: "Kerbalism",
});
