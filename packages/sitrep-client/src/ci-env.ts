/**
 * `true` when running under a CI provider. GitHub Actions (and most other
 * common CI providers) set `CI=true` by default; some set `CI=1`. Used by
 * `map-topic.rawFieldResolution.fixture.test.ts` to turn a missing
 * local-only fixture from a silent CI skip into a loud failure — see that
 * file's doc comment for the full "why".
 */
export function isCiEnvironment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CI === "true" || env.CI === "1";
}
