/** The newest published release of Gonogo, as GitHub's API answers for it. */
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/ksp-gonogo/gonogo/releases/latest";

export interface LatestRelease {
  /** The release's version, without the tag's leading `v`. */
  version: string;
  /** The release's page, for its notes. */
  url: string;
}

/**
 * The newest release, or `null` when it cannot be known: offline, refused,
 * rate-limited, or no release published yet. A `null` says nothing about
 * whether this build is current.
 */
export async function fetchLatestRelease(
  url: string = LATEST_RELEASE_URL,
): Promise<LatestRelease | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return null;
    const tag = Reflect.get(body, "tag_name");
    const page = Reflect.get(body, "html_url");
    if (typeof tag !== "string") return null;
    const version = tag.replace(/^v/i, "");
    if (!parseVersion(version)) return null;
    return { version, url: typeof page === "string" ? page : "" };
  } catch {
    return null;
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

let pending: Promise<LatestRelease | null> | undefined;
let answer: LatestRelease | null | undefined;

/**
 * The newest release, asked of GitHub at most once per page load: every
 * Settings visit after the first reads the same answer, which keeps the app
 * well inside the API's unauthenticated rate limit.
 */
export function checkLatestRelease(): Promise<LatestRelease | null> {
  pending ??= fetchLatestRelease().then((release) => {
    answer = release;
    return release;
  });
  return pending;
}

/** The answer already in hand, `undefined` while none has arrived. */
export function latestReleaseSoFar(): LatestRelease | null | undefined {
  return answer;
}

/** Forget the answer, so the next check asks again. For tests. */
export function __resetLatestRelease(): void {
  pending = undefined;
  answer = undefined;
}
