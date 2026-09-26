// The client's identity: every widget here stamps this handle as `owner`, which is what the widget picker's search tags derive from.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// The source of the client's version: `gonogo-uplink.json` is generated from it. Keep it equal to `package.json`'s.
const UPLINK_VERSION = "0.0.1";

export const BREAKING_GROUND = defineUplinkClient({
  id: "breakingGround",
  version: UPLINK_VERSION,
  name: "Breaking Ground",
  description:
    "Drives Breaking Ground robotic joints and rotors from the console, and reports " +
    "deployed surface bases on every body while you fly something else.",
});
