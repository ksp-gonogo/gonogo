// Uplink client identity (Uplink Client Contract design §3.1). One
// declaration per client bundle: every widget/augment this package
// registers stamps this handle as `owner`, so the widget picker's mod
// search tags (effectiveSearchTags) derive "scansat" automatically instead
// of relying on a per-widget field someone has to remember to set.
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk";

/**
 * This client's one version line, and it must equal `package.json`'s.
 *
 * It was `"0.0.0-dev"` under a TODO saying the build would inject it from
 * `gonogo-uplink.json`. That was backwards: the manifest is GENERATED from this
 * declaration, so the manifest cannot be the source of the number that goes into
 * it. The declaration is the source, and `gonogo-uplink docs` refuses to write a
 * manifest whose declared version disagrees with the package's, so the two cannot
 * drift without something saying so.
 */
const UPLINK_VERSION = "0.0.1";

export const SCANSAT = defineUplinkClient({
  id: "scansat",
  version: UPLINK_VERSION,
  name: "SCANsat",
});
