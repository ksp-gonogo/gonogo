import type { LogEntry } from "@ksp-gonogo/logger";

const NEW_ISSUE_URL = "https://github.com/ksp-gonogo/gonogo/issues/new";

/** Longest URL we hand to GitHub, under the roughly 8 KB it refuses. */
export const ISSUE_URL_LIMIT = 7500;

/** Longest description put in the URL, so the log always has room. */
const MAX_DESCRIPTION = 1500;

/** Fewest log lines worth sending in the URL; below this the log goes to the clipboard alone. */
const MIN_LOG_LINES = 10;

/** A titled run of log lines, oldest first. */
export interface LogSection {
  title: string;
  lines: readonly string[];
}

/** What the issue body is prefilled with. */
export interface IssueFields {
  description: string;
  modVersion: string | null;
  appVersion: string;
  uplinks: string[];
  screen: "Main screen" | "Station";
}

export interface IssueLink {
  url: string;
  /**
   * `all` put every line of every section in the URL, `trimmed` put part of the
   * log in it and `none` put no log in it. Anything but `all` has the whole log
   * in `clipboard`.
   */
  log: "all" | "trimmed" | "none";
  clipboard: string | null;
}

const PATH_PATTERNS: RegExp[] = [
  /[A-Za-z]:\\[^\s"'<>|]+/g,
  /(?:~|\.\.?)?\/(?:[\w.@+-]+\/)+[\w.@+-]*/g,
];
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PEER_ID = /\bstation-[\w-]+/g;
/* The word before a code is matched in lower, Title and upper case and the code
   in upper case only, so "peer left" is not read as a peer and a code. */
const SHARE_CODE =
  /\b((?:host|Host|HOST|code|Code|CODE|share|Share|SHARE|room|Room|ROOM|peer|Peer|PEER|station|Station|STATION))(\W{0,3})\s*[A-Z0-9]{4}\b/g;

/** A log line with paths, addresses, peer ids and share codes replaced, so it is safe to post publicly. */
export function redactLogLine(line: string): string {
  let out = line;
  for (const pattern of PATH_PATTERNS) out = out.replace(pattern, "<path>");
  return out
    .replace(IPV4, "<ip>")
    .replace(IPV6, "<ip>")
    .replace(UUID, "<id>")
    .replace(PEER_ID, "<peer>")
    .replace(SHARE_CODE, (_m, word: string) => `${word} <code>`);
}

/** The app's log entries as plain lines, oldest first. */
export function logLines(entries: readonly LogEntry[]): string[] {
  return entries.map((e) => {
    const tag = e.tag ? ` [${e.tag}]` : "";
    const error = e.error ? ` ${e.error.name}: ${e.error.message}` : "";
    return redactLogLine(
      `${e.timestamp} ${e.level.toUpperCase()}${tag} ${e.message}${error}`,
    );
  });
}

function sectionText(
  title: string,
  lines: readonly string[],
  total: number,
): string {
  const left = total - lines.length;
  const note = left > 0 ? `, ${left} older left out` : "";
  return [
    `<details><summary>${title} (${lines.length} lines${note})</summary>`,
    "",
    "```",
    lines.join("\n"),
    "```",
    "",
    "</details>",
  ].join("\n");
}

/*
 * Everything rides in `body`, which GitHub fills into a new issue whether or
 * not the repository's default branch carries an issue form. Form field ids in
 * the query are dropped when it does not, taking the description and the log
 * with them.
 */
function build(fields: IssueFields, logText: string | null): string {
  const facts = [
    fields.modVersion ? `- Mod version: ${fields.modVersion}` : null,
    `- App version: ${fields.appVersion}`,
    `- Screen: ${fields.screen}`,
    fields.uplinks.length > 0
      ? `- Installed Uplinks: ${fields.uplinks.join(", ")}`
      : null,
    "- KSP version: ",
  ].filter((line) => line !== null);
  const body = [
    "## What happened",
    fields.description.slice(0, MAX_DESCRIPTION),
    "## What you expected",
    "",
    "## Steps to make it happen",
    "",
    "## Versions",
    facts.join("\n"),
    ...(logText ? ["## Logs", logText] : []),
  ].join("\n\n");
  const params = new URLSearchParams({ labels: "bug", body });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}

/**
 * The prefilled bug report link. Sections are in priority order and each is
 * oldest first. When the URL would be too long the last sections are dropped
 * whole, then the first one that remains loses its oldest lines. Anything
 * left out is in `clipboard`.
 */
export function buildIssueLink(
  fields: IssueFields,
  sections: readonly LogSection[],
  limit: number = ISSUE_URL_LIMIT,
): IssueLink {
  const filled = sections.filter((s) => s.lines.length > 0);
  if (filled.length === 0) {
    return { url: build(fields, null), log: "none", clipboard: null };
  }
  const text = (parts: readonly LogSection[]) =>
    parts
      .map((s) => sectionText(s.title, s.lines, s.lines.length))
      .join("\n\n");
  const all = build(fields, text(filled));
  if (all.length <= limit) return { url: all, log: "all", clipboard: null };

  const clipboard = filled
    .map((s) => `${s.title}\n${s.lines.join("\n")}`)
    .join("\n\n");
  for (let kept = filled.length; kept >= 1; kept--) {
    const whole = filled.slice(0, kept);
    if (kept > 1 && build(fields, text(whole)).length <= limit) {
      return { url: build(fields, text(whole)), log: "trimmed", clipboard };
    }
    if (kept > 1) continue;
    const [first] = whole;
    const fits = (keep: number) =>
      build(
        fields,
        sectionText(first.title, first.lines.slice(-keep), first.lines.length),
      ).length <= limit;
    if (first.lines.length > MIN_LOG_LINES && fits(MIN_LOG_LINES)) {
      let low = MIN_LOG_LINES;
      let high = first.lines.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (fits(mid)) low = mid;
        else high = mid - 1;
      }
      const url = build(
        fields,
        sectionText(first.title, first.lines.slice(-low), first.lines.length),
      );
      return { url, log: "trimmed", clipboard };
    }
  }
  return { url: build(fields, null), log: "none", clipboard };
}
