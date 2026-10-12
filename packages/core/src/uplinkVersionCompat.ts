/**
 * Uplink Client Contract: version compatibility.
 *
 * The manifest shape, its reader and the compat verdict live in
 * `@ksp-gonogo/sitrep-sdk/uplink-load`, where a page outside the app can read
 * them too; this re-export keeps every app-side importer on `@ksp-gonogo/core`.
 */

import { EXTENSION_API_VERSION } from "@ksp-gonogo/sitrep-sdk";

export {
  type AppCompatIdentity,
  checkUplinkCompat,
  type GonogoUplinkManifest,
  isGonogoUplinkManifest,
  parseUplinkManifest,
  type UplinkCompatVerdict,
  type UplinkCompatVerdictKind,
} from "@ksp-gonogo/sitrep-sdk/uplink-load";
export { EXTENSION_API_VERSION };
