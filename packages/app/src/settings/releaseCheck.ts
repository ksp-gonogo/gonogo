import { logger } from "@ksp-gonogo/logger";

/**
 * The newest published release of Gonogo, as GitHub's API lists them. Asked of
 * the list rather than of `releases/latest`, which answers 404 while no release
 * exists and so prints a failed request on every page load for a state that is
 * not a failure.
 */
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/ksp-gonogo/gonogo/releases?per_page=10";

export interface LatestRelease {
  /** The release's version, without the tag's leading `v`. */
  version: string;
  /** The release's page, for its notes. */
  url: string;
}

/** The answer when GitHub lists no published release yet: a normal state, not a failed check. */
export const NO_RELEASE_YET = "none";

/** What a check answers: a release, that none exists yet, or `null` when it cannot be known. */
export type ReleaseAnswer = LatestRelease | typeof NO_RELEASE_YET | null;

function unknownRelease(why: string): null {
  logger.warn(`[release-check] could not read the latest release: ${why}`);
  return null;
}

/**
 * The newest release, {@link NO_RELEASE_YET} when none is published, or `null`
 * when it cannot be known: offline, refused, rate-limited or an answer that
 * cannot be read. A `null` says nothing about whether this build is current,
 * and is logged, since it is a failure rather than an answer.
 */
async function fetchLatestRelease(
  url: string = LATEST_RELEASE_URL,
): Promise<ReleaseAnswer> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return unknownRelease(`GitHub answered ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return unknownRelease("the answer is not a list");
    for (const entry of body) {
      if (typeof entry !== "object" || entry === null) continue;
      if (Reflect.get(entry, "draft") === true) continue;
      if (Reflect.get(entry, "prerelease") === true) continue;
      const tag = Reflect.get(entry, "tag_name");
      const page = Reflect.get(entry, "html_url");
      if (typeof tag !== "string") continue;
      const version = tag.replace(/^v/i, "");
      if (!parseVersion(version)) continue;
      return { version, url: typeof page === "string" ? page : "" };
    }
    return body.length === 0
      ? NO_RELEASE_YET
      : unknownRelease("no listed release carries a readable version");
  } catch (err) {
    return unknownRelease(err instanceof Error ? err.message : String(err));
  }
}

interface Parsed {
  core: [number, number, number];
  pre: string | undefined;
}

function parseVersion(version: string): Parsed | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!m) return undefined;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

/**
 * Whether `candidate` is a later release than `current`, by semver precedence:
 * a release outranks any prerelease of the same number, so a release candidate
 * is behind the release it led to. `undefined` when either cannot be read.
 */
export function isNewer(
  candidate: string,
  current: string,
): boolean | undefined {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return undefined;
  for (let i = 0; i < 3; i++) {
    const x = a.core[i] ?? 0;
    const y = b.core[i] ?? 0;
    if (x !== y) return x > y;
  }
  if (a.pre === b.pre) return false;
  if (a.pre === undefined) return true;
  if (b.pre === undefined) return false;
  return a.pre > b.pre;
}

/**
 * Whether the mod and this app come from the same release, from the mod's own
 * release label: `v1.4.0` for a release, `rc-<sha>` for a candidate, whose app
 * carries the same sha as `-rc.<sha>`. `undefined` when the mod reports no
 * label, or one this cannot read, since that is not a mismatch.
 */
export function modMatchesApp(
  modLabel: string | null | undefined,
  appVersion: string,
): boolean | undefined {
  if (!modLabel) return undefined;
  const candidate = /^rc-([0-9a-f]+)$/i.exec(modLabel);
  if (candidate) {
    const sha = candidate[1]?.toLowerCase() ?? "";
    return appVersion.toLowerCase().endsWith(`-rc.${sha}`);
  }
  const release = modLabel.replace(/^v/i, "");
  if (!parseVersion(release)) return undefined;
  return release === appVersion;
}

/** The mod's release label as an operator reads it: a release without its tag's `v`, a candidate as it is. */
export function modVersionText(modLabel: string): string {
  return /^v\d/i.test(modLabel) ? modLabel.slice(1) : modLabel;
}

let pending: Promise<ReleaseAnswer> | undefined;
let answer: ReleaseAnswer | undefined;

/**
 * The newest release, asked of GitHub at most once per page load: every
 * Settings visit after the first reads the same answer, which keeps the app
 * well inside the API's unauthenticated rate limit.
 */
export function checkLatestRelease(): Promise<ReleaseAnswer> {
  pending ??= fetchLatestRelease().then((release) => {
    answer = release;
    return release;
  });
  return pending;
}

/** The answer already in hand, `undefined` while none has arrived. */
export function latestReleaseSoFar(): ReleaseAnswer | undefined {
  return answer;
}

/** Forget the answer, so the next check asks again. For tests. */
export function __resetLatestRelease(): void {
  pending = undefined;
  answer = undefined;
}
