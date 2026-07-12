/**
 * Minimal semver-shaped version primitives for the capability kernel.
 *
 * Versions are plain "x.y.z" strings (no external semver dependency).
 * Missing trailing components are treated as 0 (e.g. "1.2" == "1.2.0").
 */

export interface VersionRange {
  /** Inclusive lower bound. */
  min: string;
  /** Exclusive upper bound. Open-ended (any version >= min) when omitted. */
  max?: string;
}

function parseVersion(version: string): [number, number, number] {
  const parts = version.split(".");
  const major = Number(parts[0] ?? 0) || 0;
  const minor = Number(parts[1] ?? 0) || 0;
  const patch = Number(parts[2] ?? 0) || 0;
  return [major, minor, patch];
}

/**
 * Numeric (not lexical) semver comparison.
 * Returns <0 if a<b, 0 if equal, >0 if a>b.
 */
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/**
 * Gate: does the running kernel satisfy a provider's declared minimum
 * kernel version? Inclusive — kernelVersion === minKernelVersion passes.
 * An undefined minimum is always satisfied.
 */
export function satisfiesKernel(
  kernelVersion: string,
  minKernelVersion: string | undefined,
): boolean {
  if (minKernelVersion === undefined) return true;
  return compareVersions(kernelVersion, minKernelVersion) >= 0;
}

/**
 * Gate: does a provider's own version fall within a required range?
 * min is inclusive, max is exclusive; an omitted max is open-ended.
 * An undefined range is always satisfied. An undefined modVersion cannot
 * satisfy a defined range (nothing to verify against).
 */
export function satisfiesModRange(
  modVersion: string | undefined,
  range: VersionRange | undefined,
): boolean {
  if (range === undefined) return true;
  if (modVersion === undefined) return false;

  if (compareVersions(modVersion, range.min) < 0) return false;
  if (range.max !== undefined && compareVersions(modVersion, range.max) >= 0)
    return false;

  return true;
}
