/** Types for `scan-domains.mjs`, plain ESM so `scan-scope.mjs` can load it. */

/** A change to a path matching any of these runs every scan. */
export const SCANS_RUN_ON_ANY_CHANGE: readonly RegExp[];

/** Scan test file (relative to packages/core) to the repo paths it can see. */
export const SCAN_DOMAINS: Readonly<Record<string, readonly RegExp[]>>;
