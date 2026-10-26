/**
 * The places a wrapped mod publishes its releases, as `uplink.json`'s
 * `mod.channels` lists them, and the reads that ask each one for its newest
 * stable release.
 */

import {
  compareCkan,
  compareVersions,
  isPrerelease,
  normalisedVersion,
  plainVersion,
} from "./version";

/**
 * One place the KSP mod an Uplink wraps publishes its releases, as an entry of
 * `mod.channels` in `uplink.json`: a CKAN identifier, a GitHub repository whose
 * latest release counts, a GitHub repository released by tag, a SpaceDock mod
 * id, or an npm package and dist-tag. Exactly one key names the kind. Useful
 * for letting `uplink-tools deps` read the newest stable release on every
 * channel and show the operator which one lags. Used by `deps` and `deps bump`.
 *
 * @category Uplink page
 */
export type ModChannel =
  | {
      /** The mod's CKAN identifier. */
      ckan: string;
    }
  | {
      /** The GitHub repository, as `owner/repo`, whose latest non-prerelease release counts. */
      github: string;
      /** A regular expression whose `version` group reads the version from the release tag. */
      tag?: string;
      /** A regular expression picking the release archive a bump downloads. */
      asset?: string;
    }
  | {
      /** The GitHub repository, as `owner/repo`, that releases by tag alone. */
      githubTags: string;
      /** A regular expression with an `order` group that numbers the tags; the highest number is the newest. */
      pattern: string;
    }
  | {
      /** The mod's numeric SpaceDock id. */
      spacedock: number;
    }
  | {
      /** The npm package that moves with the mod. */
      npm: string;
      /** The dist-tag that names the newest release (default `latest`). */
      distTag?: string;
    };

/** What a channel said its newest stable release is. */
export interface ChannelAnswer {
  /** The channel, as the report prints it: `github example-org/example-mod`. */
  channel: string;
  /** The release in the plain dotted form, with no epoch and no leading `v`; the whole tag for a tag channel. */
  version: string;
  /** What a tag channel orders by; absent elsewhere. */
  order?: string;
  /** The version as CKAN spells it, with its epoch and `v`, on a CKAN channel. */
  ckanVersion?: string;
  publishedAt?: string;
  /** Where the release is described. */
  url?: string;
  /** The archive the release ships, when the channel names one. */
  download?: string;
}

/** What reading one channel produced: an answer, or the reason there is none. */
export interface ChannelResult {
  channel: string;
  answer?: ChannelAnswer;
  /** Why the channel's newest release was set aside, when it is a prerelease. */
  skipped?: string;
  error?: string;
}

/** The network the reads use, replaceable so a test runs on recorded responses. */
export interface Http {
  json(url: string): Promise<unknown>;
  bytes(url: string): Promise<Uint8Array>;
}

export interface ReadOptions {
  includePrerelease?: boolean;
}

const KINDS = ["ckan", "github", "githubTags", "spacedock", "npm"] as const;

export function channelLabel(channel: ModChannel): string {
  if ("ckan" in channel) return `ckan ${channel.ckan}`;
  if ("github" in channel) return `github ${channel.github}`;
  if ("githubTags" in channel) return `github-tags ${channel.githubTags}`;
  if ("spacedock" in channel) return `spacedock ${channel.spacedock}`;
  return `npm ${channel.npm} ${channel.distTag ?? "latest"}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The channels a `mod.channels` or `ckanDepends[].channels` value declares, or
 * the sentences saying what is wrong with it. An absent value is no channels.
 */
export function parseChannels(
  value: unknown,
  where: string,
): { channels: ModChannel[]; problems: string[] } {
  const problems: string[] = [];
  const channels: ModChannel[] = [];
  if (value === undefined) return { channels, problems };
  if (!Array.isArray(value)) {
    return {
      channels,
      problems: [
        `${where} must be a list of channels, such as [{ "ckan": "Example-1" }]`,
      ],
    };
  }
  value.forEach((entry, index) => {
    const at = `${where}[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${at} must be an object naming one channel`);
      return;
    }
    const kinds = KINDS.filter((kind) => entry[kind] !== undefined);
    if (kinds.length !== 1) {
      problems.push(
        `${at} must name exactly one of ${KINDS.map((k) => `"${k}"`).join(", ")}, and it names ${kinds.length === 0 ? "none" : kinds.map((k) => `"${k}"`).join(" and ")}`,
      );
      return;
    }
    const kind = kinds[0];
    const named = entry[kind];
    if (kind === "spacedock") {
      if (typeof named !== "number" || !Number.isInteger(named)) {
        problems.push(`${at}.spacedock must be the mod's numeric SpaceDock id`);
        return;
      }
      channels.push({ spacedock: named });
      return;
    }
    if (typeof named !== "string" || named === "") {
      problems.push(`${at}.${kind} must be a non-empty string`);
      return;
    }
    if (
      (kind === "github" || kind === "githubTags") &&
      !/^[\w.-]+\/[\w.-]+$/.test(named)
    ) {
      problems.push(
        `${at}.${kind} must be "owner/repo", and "${named}" is not`,
      );
      return;
    }
    if (kind === "ckan") {
      channels.push({ ckan: named });
      return;
    }
    if (kind === "npm") {
      const distTag = entry.distTag;
      channels.push(
        typeof distTag === "string" ? { npm: named, distTag } : { npm: named },
      );
      return;
    }
    if (kind === "github") {
      channels.push({
        github: named,
        ...(typeof entry.tag === "string" ? { tag: entry.tag } : {}),
        ...(typeof entry.asset === "string" ? { asset: entry.asset } : {}),
      });
      return;
    }
    const pattern = entry.pattern;
    if (typeof pattern !== "string") {
      problems.push(
        `${at}.pattern is needed: a regular expression with an (?<order>...) group that numbers the tags`,
      );
      return;
    }
    try {
      new RegExp(pattern);
    } catch {
      problems.push(`${at}.pattern is not a regular expression`);
      return;
    }
    channels.push({ githubTags: named, pattern });
  });
  return { channels, problems };
}

const fail = (channel: ModChannel, what: string): never => {
  throw new Error(`${channelLabel(channel)}: ${what}`);
};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** The version a GitHub tag carries: the tag's `version` group, else its first dotted number. */
export function versionOfTag(
  tag: string,
  pattern?: string,
): string | undefined {
  if (pattern !== undefined) {
    const match = new RegExp(pattern).exec(tag);
    return match?.groups?.version ?? match?.[1];
  }
  return /\d+(?:\.\d+)*(?:-(?:rc|alpha|beta|dev|pre)[.\w]*)?/i.exec(tag)?.[0];
}

async function readGithub(
  channel: Extract<ModChannel, { github: string }>,
  http: Http,
  options: ReadOptions,
): Promise<ChannelAnswer> {
  const base = `https://api.github.com/repos/${channel.github}/releases`;
  let release: unknown;
  if (options.includePrerelease) {
    const list = await http.json(`${base}?per_page=30`);
    release = Array.isArray(list)
      ? list.find((r) => isRecord(r) && r.draft !== true)
      : undefined;
  } else {
    release = await http.json(`${base}/latest`);
  }
  if (!isRecord(release)) return fail(channel, "no release came back");
  const tag = str(release.tag_name);
  if (!tag) return fail(channel, "the release carries no tag");
  if (!options.includePrerelease && release.prerelease === true) {
    return fail(channel, `the latest release ${tag} is a prerelease`);
  }
  const version = versionOfTag(tag, channel.tag);
  if (!version)
    return fail(channel, `no version can be read from the tag "${tag}"`);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const wanted = channel.asset ? new RegExp(channel.asset) : undefined;
  const zip = assets.find((asset) => {
    const name = isRecord(asset) ? str(asset.name) : undefined;
    return (
      name !== undefined &&
      (wanted
        ? wanted.test(name)
        : /\.zip$/i.test(name) && !/source|src/i.test(name))
    );
  });
  return {
    channel: channelLabel(channel),
    version,
    publishedAt: str(release.published_at),
    url: str(release.html_url),
    download: isRecord(zip) ? str(zip.browser_download_url) : undefined,
  };
}

async function readGithubTags(
  channel: Extract<ModChannel, { githubTags: string }>,
  http: Http,
): Promise<ChannelAnswer> {
  const tags = await http.json(
    `https://api.github.com/repos/${channel.githubTags}/tags?per_page=100`,
  );
  if (!Array.isArray(tags)) return fail(channel, "no tag list came back");
  const pattern = new RegExp(channel.pattern);
  let best: { name: string; order: string } | undefined;
  for (const tag of tags) {
    const name = isRecord(tag) ? str(tag.name) : undefined;
    const order =
      name === undefined ? undefined : pattern.exec(name)?.groups?.order;
    if (name === undefined || order === undefined) continue;
    if (!best || compareOrder(order, best.order) > 0) best = { name, order };
  }
  if (!best) return fail(channel, "no tag matches the pattern");
  return {
    channel: channelLabel(channel),
    version: best.name,
    order: best.order,
    url: `https://github.com/${channel.githubTags}/releases/tag/${encodeURIComponent(best.name)}`,
  };
}

/** Orders two digit strings of a tag channel as numbers. */
export function compareOrder(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

async function readSpacedock(
  channel: Extract<ModChannel, { spacedock: number }>,
  http: Http,
): Promise<ChannelAnswer> {
  const mod = await http.json(
    `https://spacedock.info/api/mod/${channel.spacedock}`,
  );
  const first =
    isRecord(mod) && Array.isArray(mod.versions) ? mod.versions[0] : undefined;
  const version = isRecord(first) ? str(first.friendly_version) : undefined;
  if (!version) return fail(channel, "the mod lists no version");
  return {
    channel: channelLabel(channel),
    version: plainVersion(version),
    publishedAt: isRecord(first) ? str(first.created) : undefined,
    url: `https://spacedock.info/mod/${channel.spacedock}`,
  };
}

async function readNpm(
  channel: Extract<ModChannel, { npm: string }>,
  http: Http,
): Promise<ChannelAnswer> {
  const doc = await http.json(
    `https://registry.npmjs.org/${channel.npm.replace("/", "%2f")}`,
  );
  const tags = isRecord(doc) ? doc["dist-tags"] : undefined;
  const tag = channel.distTag ?? "latest";
  const version = isRecord(tags) ? str(tags[tag]) : undefined;
  if (!version) return fail(channel, `the package has no "${tag}" dist-tag`);
  const versions = isRecord(doc) ? doc.versions : undefined;
  const entry = isRecord(versions) ? versions[version] : undefined;
  if (isRecord(entry) && entry.deprecated !== undefined) {
    return fail(channel, `"${tag}" points at ${version}, which is deprecated`);
  }
  const time = isRecord(doc) ? doc.time : undefined;
  return {
    channel: channelLabel(channel),
    version,
    publishedAt: isRecord(time) ? str(time[version]) : undefined,
    url: `https://www.npmjs.com/package/${channel.npm}/v/${version}`,
  };
}

/** A CKAN-meta file name's version: the epoch is written `N-` in a file name where the version writes `N:`. */
function versionOfCkanFile(
  identifier: string,
  file: string,
): string | undefined {
  const prefix = `${identifier}-`;
  if (!file.startsWith(prefix) || !file.endsWith(".ckan")) return undefined;
  const suffix = file.slice(prefix.length, -".ckan".length);
  const epoch = /^(\d+)-(.+)$/.exec(suffix);
  return epoch ? `${epoch[1]}:${epoch[2]}` : suffix;
}

const CKAN_META = "https://api.github.com/repos/KSP-CKAN/CKAN-meta/contents";
const CKAN_RAW = "https://raw.githubusercontent.com/KSP-CKAN/CKAN-meta/master";
const CKAN_CANDIDATES = 8;

/** The files CKAN-meta holds for a mod, newest first by CKAN's own ordering. */
async function ckanEntries(
  channel: Extract<ModChannel, { ckan: string }>,
  http: Http,
): Promise<{ file: string; version: string }[]> {
  const listing = await http.json(`${CKAN_META}/${channel.ckan}`);
  if (!Array.isArray(listing))
    return fail(channel, "CKAN-meta lists nothing for it");
  const entries: { file: string; version: string }[] = [];
  for (const item of listing) {
    const file = isRecord(item) ? str(item.name) : undefined;
    const version = file ? versionOfCkanFile(channel.ckan, file) : undefined;
    if (file && version) entries.push({ file, version });
  }
  if (entries.length === 0)
    return fail(channel, "CKAN-meta holds no entry for it");
  return entries.sort((a, b) => compareCkan(b.version, a.version));
}

async function ckanEntry(
  channel: Extract<ModChannel, { ckan: string }>,
  file: string,
  http: Http,
): Promise<Record<string, unknown>> {
  const entry = await http.json(`${CKAN_RAW}/${channel.ckan}/${file}`);
  if (!isRecord(entry)) return fail(channel, `${file} is not a CKAN entry`);
  return entry;
}

async function readCkan(
  channel: Extract<ModChannel, { ckan: string }>,
  http: Http,
  options: ReadOptions,
): Promise<ChannelAnswer> {
  const entries = await ckanEntries(channel, http);
  for (const { file } of entries.slice(0, CKAN_CANDIDATES)) {
    const entry = await ckanEntry(channel, file, http);
    const status = str(entry.release_status) ?? "stable";
    if (status !== "stable" && !options.includePrerelease) continue;
    const version = str(entry.version);
    if (!version) return fail(channel, `${file} carries no version`);
    const download = Array.isArray(entry.download)
      ? entry.download[0]
      : entry.download;
    return {
      channel: channelLabel(channel),
      version: plainVersion(version),
      ckanVersion: version,
      url: `https://github.com/KSP-CKAN/CKAN-meta/blob/master/${channel.ckan}/${file}`,
      download: str(download),
    };
  }
  return fail(channel, "none of its newest entries is a stable release");
}

/**
 * The version string CKAN lists for the release a pin names, in CKAN's own
 * spelling with its epoch and leading `v`, or undefined when CKAN lists no such
 * release. A relationship's `min_version` has to be written this way: CKAN
 * orders the epoch first and a `v` above no prefix, so `4.7.0.0` is satisfied
 * by every `v4.x` release and `15.15.0` by every `1:v15.x` one.
 */
export async function ckanSpelling(
  identifier: string,
  pin: string,
  http: Http,
): Promise<string | undefined> {
  const channel = { ckan: identifier };
  const wanted = normalisedVersion(pin);
  for (const { file, version } of await ckanEntries(channel, http)) {
    if (normalisedVersion(version) !== wanted) continue;
    const entry = await ckanEntry(channel, file, http);
    return str(entry.version) ?? version;
  }
  return undefined;
}

function readAny(
  channel: ModChannel,
  http: Http,
  options: ReadOptions,
): Promise<ChannelAnswer> {
  if ("ckan" in channel) return readCkan(channel, http, options);
  if ("github" in channel) return readGithub(channel, http, options);
  if ("githubTags" in channel) return readGithubTags(channel, http);
  if ("spacedock" in channel) return readSpacedock(channel, http);
  return readNpm(channel, http);
}

/** Asks one channel for its newest stable release. */
export async function readChannel(
  channel: ModChannel,
  http: Http,
  options: ReadOptions = {},
): Promise<ChannelResult> {
  const label = channelLabel(channel);
  try {
    const answer = await readAny(channel, http, options);
    if (
      !options.includePrerelease &&
      !("npm" in channel) &&
      !answer.order &&
      isPrerelease(answer.version)
    ) {
      return {
        channel: label,
        skipped: `its newest release ${answer.version} is a prerelease`,
      };
    }
    return { channel: label, answer };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      channel: label,
      error: message.startsWith(label) ? message : `${label}: ${message}`,
    };
  }
}

/** The highest of several answers; ties keep the earliest, so the channel listed first wins. */
export function newestAnswer(
  answers: readonly ChannelAnswer[],
): ChannelAnswer | undefined {
  const higher = (a: ChannelAnswer, b: ChannelAnswer): boolean =>
    a.order !== undefined && b.order !== undefined
      ? compareOrder(a.order, b.order) > 0
      : compareVersions(a.version, b.version) > 0;
  let best: ChannelAnswer | undefined;
  for (const answer of answers) {
    if (!best || higher(answer, best)) best = answer;
  }
  return best;
}
