// The app's Uplink-compat identity — the three version values a runtime-loaded
// Uplink is gated against BEFORE `import()` (design §5 step 3). Single-sourced in
// vite.config.ts and injected via `define`; the same values are written into the
// local registry fixture, so host and descriptor cannot drift in Phase A.
//
// Guarded with the `typeof … !== "undefined"` pattern (see version.ts) so the
// module is import-safe under vitest, where the defines are absent.

export interface HostCompat {
  /** The @ksp-gonogo extension-API surface version (tracked by sitrep-sdk today). */
  apiVersion: string;
  /** The @ksp-gonogo/ui-kit version. */
  uiKitVersion: string;
  /** The C# ContractVersion.Major mirror. */
  contractMajor: number;
}

export const hostCompat: HostCompat = {
  apiVersion:
    typeof __GONOGO_API_VERSION__ !== "undefined"
      ? __GONOGO_API_VERSION__
      : "0.0.0",
  uiKitVersion:
    typeof __GONOGO_UIKIT_VERSION__ !== "undefined"
      ? __GONOGO_UIKIT_VERSION__
      : "0.0.0",
  contractMajor:
    typeof __GONOGO_CONTRACT_MAJOR__ !== "undefined"
      ? __GONOGO_CONTRACT_MAJOR__
      : 0,
};
