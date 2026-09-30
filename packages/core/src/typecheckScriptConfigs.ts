/**
 * The tsconfig paths a package's `typecheck` script actually runs,
 * workspace-relative.
 *
 * A bare `tsc --noEmit` (or any `tsc` invocation naming no `-p` / `--project`)
 * resolves the nearest `tsconfig.json`, which for a package script is its own;
 * an explicit `-p X` names one outright. A script may chain several
 * invocations with `&&`, and every one of them counts: what a run actually
 * type checks is the union of what each named config resolves.
 *
 * Shared by `typecheck-coverage.test.ts` (is a package's own test suite
 * inside the run) and `entry-point-typecheck-coverage.test.ts` (is a render
 * harness or probe entry point inside it), so the parsing of what a
 * `typecheck` script names lives once rather than drifting between two
 * readers of the same string.
 */
export function tsconfigsRunBy(
  pkgDir: string,
  typecheckScript: string | undefined,
): string[] {
  if (typecheckScript === undefined) return [];
  const configs: string[] = [];
  for (const invocation of typecheckScript.matchAll(/tsc\s+([^&|;]*)/g)) {
    const explicit = invocation[1]?.match(/(?:-p|--project)\s+(\S+)/);
    configs.push(`${pkgDir}/${explicit ? explicit[1] : "tsconfig.json"}`);
  }
  return configs;
}
