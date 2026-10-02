// The client's identity: every registration here stamps this handle as `owner`.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// The source of the client's version: `gonogo-uplink.json` is generated from it. Keep it equal to `package.json`'s.
const UPLINK_VERSION = "0.0.1";

export const MAKING_HISTORY = defineUplinkClient({
  id: "makingHistory",
  version: UPLINK_VERSION,
  name: "Making History",
  description:
    "Lists the running Making History mission's objectives in the Objectives widget, " +
    "each marked pending, under way, reached or failed.",
});
