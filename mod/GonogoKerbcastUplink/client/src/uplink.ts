// Uplink client identity: one declaration per client bundle, stamped as `owner`
// on everything this package registers, so the widget picker's mod tags and the
// contribution ids derive from it rather than from a field someone has to
// remember at each registration.
//
// This was the last Uplink without one. `registerUplinkHandle("kerbcast", ...)`
// stood in for it and is a different thing: it names a DATA SOURCE, not a client,
// so nothing here had a client id, a version or a name. Anything that reads the
// registry by client, the generated page and the render harness included, saw a
// bundle declaring no Uplink at all.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// TODO(version): build-inject this from gonogo-uplink.json.
const UPLINK_VERSION = "0.0.1";

export const KERBCAST = defineUplinkClient({
  id: "kerbcast",
  version: UPLINK_VERSION,
  name: "Kerbcast",
  description:
    "Live in-flight camera views from Hullcam VDS parts, fed by the kerbcast sidecar. " +
    "Aim and zoom ride the Uplink; the video stays on kerbcast's own WebRTC path.",
});
