// Uplink client identity: one declaration per client bundle, stamped as `owner`
// on everything this package registers, so the widget picker's mod tags and the
// contribution ids derive from it rather than from a field someone has to
// remember at each registration.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

// TODO(version): build-inject this from gonogo-uplink.json.
const UPLINK_VERSION = "0.0.1";

export const PRINCIPIA = defineUplinkClient({
  id: "principia",
  version: UPLINK_VERSION,
  name: "Principia",
  description:
    "Publishes Principia's n-body state: trajectory arcs, the flight plan and its " +
    "burns, the reference frame they are expressed in, and the integrator settings.",
});
