/**
 * The specifier -> external-entry-chunk pairs the app bakes into its import map.
 *
 * Extracted out of `vite.config.ts` so a test can read the same list the build
 * uses. Checking a hand-copied duplicate of it proves nothing: the defect this
 * list governs is a MISSING pair, and a copy that also omits the pair agrees
 * with the build and reports clean.
 *
 * Paths deliberately stay in `vite.config.ts`.
 *
 * The LIST itself now lives in `@ksp-gonogo/sitrep-sdk`, where it ships. It was
 * only here, which is private and unpublished, so an author outside this repo had
 * to hand-copy it to build a loadable bundle, and a hand copy of a list whose
 * failure mode is a MISSING entry agrees with the original by omission. This
 * re-exports rather than restating, so the app and every external author read one
 * list and cannot drift.
 */

export {
  UPLINK_EXTERNAL_ENTRIES,
  UPLINK_EXTERNAL_NO_CHUNK,
  UPLINK_EXTERNAL_SPECIFIERS,
} from "@ksp-gonogo/sitrep-sdk/uplink-externals";
