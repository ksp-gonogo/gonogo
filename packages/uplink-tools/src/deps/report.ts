/**
 * `uplink-tools deps`: the dependencies an Uplink pins, each read against every
 * channel it publishes on.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  type ChannelAnswer,
  type ChannelResult,
  compareOrder,
  type Http,
  type ModChannel,
  newestAnswer,
  parseChannels,
  readChannel,
} from "./channels";
import { compareVersions, normalisedVersion } from "./version";

export type DependencyState =
  | "current"
  | "behind"
  | "ahead"
  | "unwatched"
  | "unreachable"
  | "vendored";

export type DependencyKind = "mod" | "ckan-dependency" | "gonogo";

export type Binding = "compile" | "reflection" | "n/a";

export interface Dependency {
  name: string;
  kind: DependencyKind;
  /** What the Uplink pins, or null where it pins nothing. */
  pinned: string | null;
  /** The highest stable release across the channels, or null where none answered. */
  newest: string | null;
  /** The channel that gave `newest`. */
  channel: string | null;
  binds: Binding;
  state: DependencyState;
  url: string | null;
  publishedAt: string | null;
  /** Each channel's own answer, so one that lags shows as lagging. */
  channels: ChannelResult[];
  /** Gonogo's own packages are reported and never bumped. */
  reportOnly: boolean;
  /** The packages that move with the mod, pinned exactly in the client. */
  packages?: string[];
  /** The answer `newest` was read from, for a bump to act on. */
  answer?: ChannelAnswer;
}

export interface DepsReport {
  schema: "uplink-deps/1";
  uplink: string;
  dependencies: Dependency[];
}

export interface ReportOptions {
  uplinkDir: string;
  http: Http;
  /** The npm dist-tag gonogo's own packages are followed on. */
  gonogo?: "latest" | "rc";
  includePrerelease?: boolean;
}

export const GONOGO_PACKAGES = [
  "@ksp-gonogo/sitrep-sdk",
  "@ksp-gonogo/ui-kit",
  "@ksp-gonogo/uplink-tools",
] as const;

export const readJsonFile = (path: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** How the C# half reaches the mod: a HintPath ending in the mod's assembly is `compile`, anything else `reflection`. */
export function bindingOf(
  uplinkDir: string,
  assembly: string | undefined,
): Binding {
  if (!assembly) return "reflection";
  const file = basename(assembly);
  const modDir = join(uplinkDir, "mod");
  if (!existsSync(modDir)) return "reflection";
  const hinted = readdirSync(modDir)
    .filter((entry) => entry.endsWith(".csproj"))
    .some((entry) =>
      readFileSync(join(modDir, entry), "utf8")
        .match(/<HintPath>[^<]*<\/HintPath>/g)
        ?.some((hint) => hint.endsWith(`${file}</HintPath>`)),
    );
  return hinted ? "compile" : "reflection";
}

/** The semver floor of a client dependency range, which for an exact pin is the pin. */
export function pinOfRange(range: string): string {
  return range.replace(/^[\^~=v\s]+/, "");
}

function clientPin(clientDir: string, name: string): string | undefined {
  const file = join(clientDir, "package.json");
  if (!existsSync(file)) return undefined;
  const manifest = readJsonFile(file);
  for (const block of ["dependencies", "devDependencies"]) {
    const range = asString(asRecord(manifest[block])[name]);
    if (range) return range;
  }
  return undefined;
}

/** The contract package's version, from the `Directory.Build.props` above the Uplink. */
function contractPin(uplinkDir: string): string | undefined {
  let dir = uplinkDir;
  for (let up = 0; up < 4; up++) {
    const file = join(dir, "Directory.Build.props");
    if (existsSync(file)) {
      const match = /<GonogoContractVersion[^>]*>([^<]+)</.exec(
        readFileSync(file, "utf8"),
      );
      if (match) return match[1].trim();
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

interface Judged {
  state: DependencyState;
  answer?: ChannelAnswer;
}

/** Judges a pin against what the channels answered. */
function judge(
  pinned: string | null,
  results: readonly ChannelResult[],
  declared: readonly ModChannel[],
): Judged {
  if (declared.length === 0 || pinned === null) return { state: "unwatched" };
  const answers = results.flatMap((r) => (r.answer ? [r.answer] : []));
  const answer = newestAnswer(answers);
  if (!answer) {
    return {
      state: results.some((r) => r.error) ? "unreachable" : "unwatched",
    };
  }
  const against = (a: ChannelAnswer): number => {
    if (a.order !== undefined) {
      const mine = /^\d+/.exec(pinned)?.[0];
      return mine === undefined ? 1 : compareOrder(a.order, mine);
    }
    return compareVersions(a.version, pinned);
  };
  if (against(answer) > 0) return { state: "behind", answer };
  if (
    normalisedVersion(answer.version) === normalisedVersion(pinned) ||
    answers.some((a) => against(a) === 0)
  ) {
    return { state: "current", answer };
  }
  return { state: "ahead", answer };
}

async function watch(
  base: Omit<
    Dependency,
    | "state"
    | "newest"
    | "channel"
    | "url"
    | "publishedAt"
    | "channels"
    | "answer"
  >,
  declared: readonly ModChannel[],
  http: Http,
  options: ReportOptions,
): Promise<Dependency> {
  const channels = await Promise.all(
    declared.map((channel) =>
      readChannel(channel, http, {
        includePrerelease: options.includePrerelease,
      }),
    ),
  );
  const { state, answer } = judge(base.pinned, channels, declared);
  return {
    ...base,
    state,
    newest: answer?.version ?? null,
    channel: answer?.channel ?? null,
    url: answer?.url ?? null,
    publishedAt: answer?.publishedAt ?? null,
    channels,
    answer,
  };
}

/** Everything `uplink.json` declares about channels that is wrong, as sentences. */
export function channelProblems(uplinkDir: string): string[] {
  const file = join(uplinkDir, "uplink.json");
  if (!existsSync(file)) return [];
  const uplink = readJsonFile(file);
  const mod = asRecord(uplink.mod);
  const problems = parseChannels(
    mod.channels,
    "uplink.json mod.channels",
  ).problems;
  const depends = Array.isArray(uplink.ckanDepends) ? uplink.ckanDepends : [];
  depends.forEach((entry, index) => {
    problems.push(
      ...parseChannels(
        asRecord(entry).channels,
        `uplink.json ckanDepends[${index}].channels`,
      ).problems,
    );
  });
  return problems;
}

/** Reads every dependency the Uplink pins against every channel it lists. */
export async function buildReport(options: ReportOptions): Promise<DepsReport> {
  const { uplinkDir, http } = options;
  const uplink = readJsonFile(join(uplinkDir, "uplink.json"));
  const problems = channelProblems(uplinkDir);
  if (problems.length > 0) throw new Error(problems.join("\n"));
  const clientDir = join(uplinkDir, "client");
  const dependencies: Dependency[] = [];

  const mod = asRecord(uplink.mod);
  const modName = asString(mod.name);
  if (modName) {
    const packages = Array.isArray(mod.packages)
      ? mod.packages.filter((p): p is string => typeof p === "string")
      : [];
    const declared = [
      ...parseChannels(mod.channels, "mod.channels").channels,
      ...packages.map((npm): ModChannel => ({ npm })),
    ];
    dependencies.push(
      await watch(
        {
          name: modName,
          kind: "mod",
          pinned: asString(mod.builtAgainst) ?? null,
          binds: bindingOf(uplinkDir, asString(mod.assembly)),
          reportOnly: false,
          ...(packages.length > 0 ? { packages } : {}),
        },
        declared,
        http,
        options,
      ),
    );
  }

  const depends = Array.isArray(uplink.ckanDepends) ? uplink.ckanDepends : [];
  for (const entry of depends) {
    const record = asRecord(entry);
    const name = asString(record.name);
    const { channels } = parseChannels(record.channels, "ckanDepends.channels");
    if (!name || channels.length === 0) continue;
    dependencies.push(
      await watch(
        {
          name,
          kind: "ckan-dependency",
          pinned: asString(record.min_version) ?? null,
          binds: "n/a",
          reportOnly: false,
        },
        channels,
        http,
        options,
      ),
    );
  }

  const tag = options.gonogo ?? "latest";
  const gonogo: { name: string; pin: string | undefined; npm: string }[] = [
    ...GONOGO_PACKAGES.map((name) => ({
      name,
      pin: clientPin(clientDir, name),
      npm: name,
    })),
    {
      name: "KspGonogo.Sitrep.Contract",
      pin: contractPin(uplinkDir),
      npm: "@ksp-gonogo/sitrep-sdk",
    },
  ];
  for (const { name, pin, npm } of gonogo) {
    if (pin === undefined) continue;
    const vendored = pin.startsWith("file:") || /(?:^|[.-])pin\./.test(pin);
    const dependency = await watch(
      {
        name,
        kind: "gonogo",
        pinned: vendored ? "vendored" : pinOfRange(pin),
        binds: "n/a",
        reportOnly: true,
      },
      [{ npm, distTag: tag }],
      http,
      options,
    );
    if (vendored) dependency.state = "vendored";
    dependencies.push(dependency);
  }

  return {
    schema: "uplink-deps/1",
    uplink: asString(uplink.id) ?? basename(uplinkDir),
    dependencies,
  };
}

/** The report as `--json` prints it: no internal answer, a null for every absent field. */
export function reportJson(report: DepsReport): string {
  return `${JSON.stringify(
    {
      ...report,
      dependencies: report.dependencies.map(
        ({ answer: _answer, ...rest }) => rest,
      ),
    },
    null,
    2,
  )}\n`;
}

/** The exit code a report earns: 2 when a channel could not be read, 10 when something is behind, otherwise 0. */
export function reportExit(report: DepsReport): number {
  const unread = report.dependencies.some((d) =>
    d.channels.some((c) => c.error),
  );
  if (unread) return 2;
  const behind = report.dependencies.some(
    (d) => d.state === "behind" && !d.reportOnly,
  );
  return behind ? 10 : 0;
}

/** The report as a table, one row per dependency. */
export function reportTable(report: DepsReport): string {
  const head = ["dependency", "pinned", "newest", "channel", "binds", "state"];
  const rows = report.dependencies.map((d) => [
    d.name,
    d.pinned ?? "-",
    d.newest ?? "-",
    d.channel ?? "-",
    d.binds,
    d.reportOnly && d.state === "behind" ? "behind (report only)" : d.state,
  ]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  const lines = [line(head), ...rows.map(line)];
  for (const d of report.dependencies) {
    for (const c of d.channels) {
      if (c.error) lines.push(`  ${d.name}: ${c.error}`);
      if (c.skipped) lines.push(`  ${d.name}: ${c.channel}: ${c.skipped}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
