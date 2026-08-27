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

/**
 * Published entry points that are NOT expected to load under a bare `node`
 * import, and the reason each one is not.
 *
 * The probe's runtime leg EXECUTES an import of every subpath the two packages
 * publish, because the typecheck leg above cannot: TypeScript resolves a
 * relative `./api` under `moduleResolution: "bundler"` and Node's ESM resolver
 * does not, so a package whose emit carries no file extensions typechecks
 * perfectly and throws ERR_MODULE_NOT_FOUND on its first line. That is what
 * `@ksp-gonogo/sitrep-sdk@0.0.1` did for every consumer that is not a bundler,
 * for as long as it was on npm, with every gate in this repo green.
 *
 * Bare `node` is the gate deliberately, and not vitest, which is what an author
 * actually runs. Measured on 2026-08-27: with
 * `server: { deps: { inline: [/@ksp-gonogo/] } }` in the consumer's
 * `vitest.config.ts`, Vite transforms the dependency and its own resolver
 * performs the extension search Node refuses to, so the extensionless emit
 * PASSED under vitest. The one configuration nothing can paper over is the one
 * with no bundler in it at all.
 *
 * ## Why anything is exempt
 *
 * `@ksp-gonogo/ui-kit` is a React component library and its bundle evaluates
 * `styled.span` at module scope. `styled-components@6` ships no `exports` map,
 * only `main` (CJS) and `module` (ESM), so bare Node loads the CJS half and its
 * interop makes the default export the module namespace rather than the factory:
 * `styled.span is not a function`, before any of our code has a say. A bundler,
 * and vitest with the kit inlined, honour `module` and get the factory. Nothing
 * in this repo can fix that from the kit's side, and no author imports a React
 * component library in bare Node.
 *
 * So the kit's entries are exempt and the sdk's are not. The sdk is the half an
 * author's tests, scripts and tooling reach without a bundler, and it must load
 * as-is.
 *
 * ## A named list rather than a count
 *
 * `EXTRACTION_DEBT` counts because its population is hundreds of typecheck
 * errors. This population is a handful of named specifiers, so naming them is
 * strictly stronger: a NEW specifier that fails is a failure rather than a
 * number that grew, and the reason is recorded next to the thing it excuses
 * instead of in a commit message. An entry that starts loading is reported for
 * tightening and does not fail, the same ceiling rule as above.
 */
export const RUNTIME_IMPORT_EXEMPT = {
  "@ksp-gonogo/ui-kit":
    "evaluates styled.span at module scope; styled-components@6 has no exports map, so bare Node loads its CJS half and the default export is the namespace, not the factory",
  "@ksp-gonogo/ui-kit/testing":
    "shares tsup's chunk with the kit's root barrel, so it evaluates the same styled.span",
  "@ksp-gonogo/ui-kit/render-probe":
    "shares tsup's chunk with the kit's root barrel, so it evaluates the same styled.span",
  "@ksp-gonogo/ui-kit/page-check":
    "shares tsup's chunk with the kit's root barrel, so it evaluates the same styled.span",
  /*
   * Peer-CONDITIONAL, and that distinction is not pedantry. Every entry above
   * is a property of the package: the kit evaluates `styled.span` wherever it is
   * loaded from, so the exemption holds for any consumer. This one is a property
   * of the CONSUMER, and `uplinkindep` measured the difference on 2026-08-27:
   * `/render` loads fine in the Uplink client that installs `playwright` and
   * cannot in the one that does not, so a flat entry is load-bearing in one tree
   * and STALE in the next while reading identically in both.
   *
   * So it declares the peer it is conditional on, and the probe honours it only
   * while that peer is genuinely absent. With `playwright` installed, a failure
   * here is a real finding again.
   */
  "@ksp-gonogo/ui-kit/render": {
    reason:
      "needs the `playwright` optional peer, whose postinstall downloads browsers; too heavy for this probe to install to answer a resolution question",
    whileMissingPeer: "playwright",
  },
};
