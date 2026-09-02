/**
 * The kit version the Uplink compat gate reads, on both sides: the app's
 * `hostCompat` and an Uplink's generated `gonogo-uplink.json`.
 *
 * Held to `package.json` by `packages/core/src/contract-version-parity.test.ts`.
 * The two drifted for as long as nothing compared them, which is survivable
 * only while both sides read this constant: the 0.x rule demands an EXACT minor
 * match, so a third-party author reading the version off the package they
 * installed would have been refused with a mismatch message about a number
 * neither of them chose.
 */
export const UI_KIT_VERSION = "0.1.0";
