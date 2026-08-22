/**
 * The three version numbers an Uplink's `gonogo-uplink.json` is gated on, in the
 * one package both the app and a third-party author can read.
 *
 * They were spread across places an outside author cannot reach:
 * `EXTENSION_API_VERSION` in `@ksp-gonogo/core` (`private: true`), and the
 * contract pair as a hand-typed constant inside `packages/app/vite.config.ts`.
 * An author generating a manifest had to guess all three, and a guess is refused
 * by the compat gate with a message about a mismatch rather than about a guess.
 *
 * The app now reads these same constants, so the value it advertises and the
 * value a manifest claims cannot drift by construction. The contract pair is
 * additionally held to the C# stamp by
 * `packages/core/src/contract-version-parity.test.ts`, because a mirror nothing
 * checks is how the app came to advertise contract 5.0 against a contract that
 * had reached 12.22.
 */

/**
 * The `@ksp-gonogo` extension-surface version: the shape of `registerComponent`,
 * `registerAugment`, the hooks and the host. Hand-managed, and deliberately not
 * the sdk's package version: bump it when the surface an Uplink compiles against
 * changes, not when the package publishes.
 */
export const EXTENSION_API_VERSION = "1.0.0";

/**
 * The wire contract's major, mirroring `ContractVersion.Major` in
 * `mod/Sitrep.Contract/ContractVersion.cs`. A mismatch REFUSES an Uplink: the
 * payload shapes it was built against are not the ones on the wire.
 */
export const CONTRACT_MAJOR = 12;

/**
 * The wire contract's minor, mirroring `ContractVersion.Minor`. An Uplink built
 * against a NEWER minor than the host is refused; an older one loads, since a
 * minor is additive.
 */
export const CONTRACT_MINOR = 22;
