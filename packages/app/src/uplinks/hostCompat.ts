// The app's Uplink-compat identity: the values a runtime-loaded Uplink is
// gated against BEFORE `import()` (design §5 step 3), fed straight into core's
// `checkUplinkCompat` (packages/core/src/uplinkVersionCompat.ts) by the loader.
//
// apiVersion/uiKitVersion are each single-sourced from the package that owns
// them, `EXTENSION_API_VERSION` (core) and `UI_KIT_VERSION` (ui-kit), so
// there is exactly one place either gets bumped; no vite `define`/build-time
// injection needed for either. `vite.config.ts` reads the SAME two constants
// (via a source-text extract, not an import; see its `readExportedStringConst`
// doc comment) to stamp the local registry fixture's own `versions[]` entries,
// so the host identity here and the descriptor the loader checks it against
// can never drift in Phase A.
//
// contractMajor/contractMinor mirror the C# `ContractVersion.Major`/`.Minor`
// stamp (`mod/Sitrep.Contract/ContractVersion.cs`): that's the C# contract's
// job to bump, not Phase 2's, so it stays a hand-maintained app constant
// threaded in via vite.config.ts's `define` (`__GONOGO_CONTRACT_MAJOR__` /
// `__GONOGO_CONTRACT_MINOR__`), same as before.
//
// Guarded with the `typeof ... !== "undefined"` pattern (see version.ts) so the
// module is import-safe under vitest, where the defines are absent.

import { EXTENSION_API_VERSION } from "@ksp-gonogo/core";
import { UI_KIT_VERSION } from "@ksp-gonogo/ui-kit";

export interface HostCompat {
  /** The @ksp-gonogo extension-API surface version: core's `EXTENSION_API_VERSION`. */
  apiVersion: string;
  /** The @ksp-gonogo/ui-kit version: ui-kit's `UI_KIT_VERSION`. */
  uiKitVersion: string;
  /** The C# ContractVersion.Major mirror. */
  contractMajor: number;
  /** The C# ContractVersion.Minor mirror. */
  contractMinor: number;
}

export const hostCompat: HostCompat = {
  apiVersion: EXTENSION_API_VERSION,
  uiKitVersion: UI_KIT_VERSION,
  contractMajor:
    typeof __GONOGO_CONTRACT_MAJOR__ !== "undefined"
      ? __GONOGO_CONTRACT_MAJOR__
      : 0,
  contractMinor:
    typeof __GONOGO_CONTRACT_MINOR__ !== "undefined"
      ? __GONOGO_CONTRACT_MINOR__
      : 0,
};
