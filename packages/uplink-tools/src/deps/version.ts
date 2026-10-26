/**
 * Version spellings and orderings for the dependency watch. Each channel
 * spells a version its own way (CKAN with an epoch and a leading `v`, GitHub
 * with whatever the tag says, npm as semver), so a pin is compared with a
 * channel's answer after both are brought to one plain dotted form.
 */

const PRERELEASE_WORD =
  /^[-.+_]?(?:rc|alpha|beta|pre|preview|dev|next|canary|snapshot|pin)(?![a-z])/i;

/** CKAN's `1:` epoch and a leading `v` dropped, which is how a mod's own release page spells it. */
export function plainVersion(version: string): string {
  return version
    .trim()
    .replace(/^\d+:/, "")
    .replace(/^v(?=\d)/i, "");
}

const CORE = /^\d+(?:\.\d+)*/;

/** The dotted numbers a version starts with, and whatever follows them. */
function split(version: string): { core: number[]; rest: string } {
  const plain = plainVersion(version);
  const match = CORE.exec(plain);
  if (!match) return { core: [], rest: plain };
  return {
    core: match[0].split(".").map(Number),
    rest: plain.slice(match[0].length),
  };
}

/**
 * Whether a version is a candidate or development build of a release: the
 * numbers followed by `-rc.1`, `-beta`, `-dev` and the like. Useful for keeping
 * a candidate out of a pin on `main` and out of a CKAN relationship. Used by
 * the dependency watch, `check` and `release`.
 */
export function isPrerelease(version: string): boolean {
  return PRERELEASE_WORD.test(split(version).rest);
}

/** The version with trailing `.0` components dropped, so 15.15.0 and 15.15.0.0 are one version. */
export function normalisedVersion(version: string): string {
  const { core, rest } = split(version);
  const parts = [...core];
  while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
  return `${parts.join(".")}${rest}`;
}

function comparePrerelease(a: string, b: string): number {
  const left = a.replace(/^[-.+_]/, "").split(/[.\-_]/);
  const right = b.replace(/^[-.+_]/, "").split(/[.\-_]/);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (numeric && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (!numeric && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Orders two versions the way a release page does: the dotted numbers first
 * with a missing component read as zero, then a prerelease below the release
 * it is for (`1.11.0-rc.10` is below `1.11.0`). Negative when `a` is lower.
 * Useful for telling whether a pin is behind a channel's newest version. Used
 * by the dependency watch.
 */
export function compareVersions(a: string, b: string): number {
  const left = split(a);
  const right = split(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const x = left.core[i] ?? 0;
    const y = right.core[i] ?? 0;
    if (x !== y) return x - y;
  }
  const x = left.rest;
  const y = right.rest;
  if (x === y) return 0;
  const pre = (rest: string) => PRERELEASE_WORD.test(rest);
  if (pre(x) && !pre(y)) return -1;
  if (!pre(x) && pre(y)) return 1;
  return comparePrerelease(x, y);
}

/** A character's place in CKAN's ordering of a non-numeric run: `~` below the end of the string, letters below everything else. */
function ckanOrder(char: string | undefined): number {
  if (char === undefined) return 0;
  if (char === "~") return -1;
  return /[a-z]/i.test(char) ? char.charCodeAt(0) : char.charCodeAt(0) + 256;
}

/**
 * CKAN's own ordering of two version strings, the one a relationship's
 * `min_version` is judged by: the epoch first, then alternating runs of
 * non-digits (compared character by character, a string that ends sorting
 * below one that continues) and digits (compared as numbers). Under it
 * `v4.8.0.0` is above `4.7.0.0` and `1.11.0-rc.10` is above `1.11.0`. Negative
 * when `a` is lower. Useful for picking the newest entry CKAN lists and for
 * finding the spelling of a pinned release. Used by the dependency watch.
 */
export function compareCkan(a: string, b: string): number {
  const epoch = (text: string) => {
    const match = /^(\d+):(.*)$/s.exec(text);
    return match
      ? { epoch: Number(match[1]), rest: match[2] }
      : { epoch: 0, rest: text };
  };
  const left = epoch(a.trim());
  const right = epoch(b.trim());
  if (left.epoch !== right.epoch) return left.epoch - right.epoch;
  let x = left.rest;
  let y = right.rest;
  while (x.length > 0 || y.length > 0) {
    const xText = /^\D*/.exec(x)?.[0] ?? "";
    const yText = /^\D*/.exec(y)?.[0] ?? "";
    for (let i = 0; i < Math.max(xText.length, yText.length); i++) {
      const delta = ckanOrder(xText[i]) - ckanOrder(yText[i]);
      if (delta !== 0) return delta;
    }
    x = x.slice(xText.length);
    y = y.slice(yText.length);
    const xDigits = /^\d*/.exec(x)?.[0] ?? "";
    const yDigits = /^\d*/.exec(y)?.[0] ?? "";
    const delta = Number(xDigits || 0) - Number(yDigits || 0);
    if (delta !== 0) return delta;
    x = x.slice(xDigits.length);
    y = y.slice(yDigits.length);
  }
  return 0;
}
