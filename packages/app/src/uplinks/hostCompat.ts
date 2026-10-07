/*
 * The app's Uplink-compat identity: the values a runtime-loaded Uplink is
 * gated against BEFORE `import()`, fed straight into core's `checkUplinkCompat`
 * (packages/core/src/uplinkVersionCompat.ts) by the loader.
 *
 * Three numbers and no package version. `apiVersion` is the sdk's
 * `EXTENSION_API_VERSION`, which speaks for the surface of the sdk and of ui-kit
 * together and moves only when that surface changes. The contract pair mirrors
 * the C# `ContractVersion.Major`/`.Minor` stamp, read from the sdk by
 * vite.config.ts and threaded in through `define`
 * (`__GONOGO_CONTRACT_MAJOR__` / `__GONOGO_CONTRACT_MINOR__`).
 *
 * Guarded with the `typeof ... !== "undefined"` pattern (see version.ts) so the
 * module is import-safe under vitest, where the defines are absent.
 */

import { EXTENSION_API_VERSION } from "@ksp-gonogo/core";

export interface HostCompat {
  /** The extension API this app provides: the sdk's `EXTENSION_API_VERSION`. */
  apiVersion: string;
  /** The C# ContractVersion.Major mirror. */
  contractMajor: number;
  /** The C# ContractVersion.Minor mirror. */
  contractMinor: number;
}

export const hostCompat: HostCompat = {
  apiVersion: EXTENSION_API_VERSION,
  contractMajor:
    typeof __GONOGO_CONTRACT_MAJOR__ !== "undefined"
      ? __GONOGO_CONTRACT_MAJOR__
      : 0,
  contractMinor:
    typeof __GONOGO_CONTRACT_MINOR__ !== "undefined"
      ? __GONOGO_CONTRACT_MINOR__
      : 0,
};
