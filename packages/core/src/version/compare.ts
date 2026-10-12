import {
  type ParsedSemver,
  parseSemver,
} from "@ksp-gonogo/sitrep-sdk/uplink-load";

export type MismatchKind = "same" | "patch" | "minor" | "major" | "unknown";

export { type ParsedSemver, parseSemver };

/**
 * Categorise a (local, remote) version pair. Pre-release suffixes are
 * ignored: only the M.m.p triple drives the result. A `null`/`undefined`
 * remote, or one that doesn't parse, is `"unknown"` (treat-as-mismatch).
 */
export function compareVersions(
  local: string,
  remote: string | undefined | null,
): MismatchKind {
  const l = parseSemver(local);
  const r = parseSemver(remote);
  if (!l || !r) return "unknown";
  if (l.major !== r.major) return "major";
  if (l.minor !== r.minor) return "minor";
  if (l.patch !== r.patch) return "patch";
  return "same";
}
