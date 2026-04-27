export type MismatchKind = "same" | "patch" | "minor" | "major" | "unknown";

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/;

export function parseSemver(
  value: string | undefined | null,
): ParsedSemver | null {
  if (!value) return null;
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * Categorise a (local, remote) version pair. Pre-release suffixes are
 * ignored — only the M.m.p triple drives the result. A `null`/`undefined`
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
