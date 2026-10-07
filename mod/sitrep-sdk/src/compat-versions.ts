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

// Typed `string`, not left as the literal: the release freeze records this surface and then moves this number, and a literal type would make the move a change to the surface it had just recorded.
/**
 * The version of the surface an Uplink's client compiles against: every export
 * of `@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/ui-kit`. A removed or changed
 * export moves the major, and an added one moves the minor. The app refuses an
 * Uplink built against another major, or a newer minor than its own.
 *
 * @category Host and runtime
 */
export const EXTENSION_API_VERSION: string = "6.0.0";

/**
 * The major version of the game data contract: the shape of every payload the
 * mod sends. The app refuses an Uplink built against another major.
 *
 * @category Host and runtime
 */
export const CONTRACT_MAJOR = 29;

/**
 * The minor version of the game data contract. A minor only adds, so an Uplink
 * built against an older minor loads, and one built against a newer minor than
 * the app's is refused.
 *
 * @category Host and runtime
 */
export const CONTRACT_MINOR: number = 22;
