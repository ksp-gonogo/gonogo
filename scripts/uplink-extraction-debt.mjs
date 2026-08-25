/**
 * Known extraction debt, per Uplink: how many typecheck errors that Uplink still
 * produces when built against the PUBLISHED `@ksp-gonogo/sitrep-sdk` and
 * `@ksp-gonogo/ui-kit` instead of the workspace copies.
 *
 * Zero means the Uplink can leave: copy it into its own repository, `npm
 * install`, and it builds. That is the whole point of the number.
 *
 * **The list is empty, and it is empty because the debt was paid, not because
 * the gate was relaxed.** Before 2026-08-25 every one of the ten Uplinks failed
 * outright: 249 of 292 distinct import bindings did not resolve against what was
 * on npm. Two faults were behind it, and neither was visible from inside the
 * workspace:
 *
 *  - nothing republished the sdk, because `release.yml` publishes only when a
 *    version moves and the sdk had been `0.0.1` on both sides since its first
 *    publish. A correct skip and a fossil skip printed the same green step
 *  - a republish would not have helped: npm ignores `publishConfig` field
 *    overrides, so the tarball would have pointed consumers at TypeScript source
 *
 * ## It is a CEILING, never a floor
 *
 * A count above its entry fails. A count BELOW is reported and does not fail,
 * and is tightened deliberately with `--update --only <id>`. Same rule and the
 * same reason as `act-warning-debt.mjs`: the number can move for reasons that
 * have nothing to do with the branch under test (a transitive `@types` release
 * is enough), and a gate that failed on any downward move would go red on an
 * untouched branch on its own schedule.
 *
 * ## A new Uplink starts at zero
 *
 * An Uplink with no entry here is held to zero. Anything authored from now on
 * has to be extractable from the day it lands; only what was already here could
 * ever have been grandfathered, and none of it is any more.
 *
 * ## What is NOT counted
 *
 * Two things the probe accommodates rather than scores, because neither is a
 * dependency-graph fact:
 *
 *  - `tsconfig.json` extending `../../../tsconfig.base.json`. An Uplink leaving
 *    takes a copy of its base config, the same as any extracted package
 *  - the absence of a lockfile
 *
 * Anything that stops `npm install` from resolving at all is not a count either.
 * It is reported as CANNOT BE EXTRACTED and fails outright, because a package
 * that will not install has no typecheck result to grade. That is what caught
 * every client declaring `react` as a peer and never as a devDependency: inside
 * the workspace pnpm hoisting supplied it, and standalone `npm install` died on
 * an ERESOLVE conflict.
 *
 * Regenerate with `pnpm uplink-extraction-probe --update --only <id>` and commit
 * the diff alongside whatever you fixed. Prefer `--only`: a bare `--update`
 * rewrites every entry from one measurement.
 */

export const EXTRACTION_DEBT = {};
