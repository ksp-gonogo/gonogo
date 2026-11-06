/**
 * What an Uplink's own commits say about its next release: the bump they imply
 * and the changelog section they make.
 *
 * The commits arrive as a file a CI step wrote after it had already picked out
 * the ones that touched this Uplink, so nothing here reads git. The file is a
 * JSON array whose items are either a commit subject, or an object holding the
 * subject and, when the commit footer carried a `BREAKING CHANGE`, `breaking:
 * true`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Change {
  type: string;
  scope?: string;
  description: string;
  breaking: boolean;
}

export type BumpLevel = "major" | "minor" | "patch";

const SUBJECT = /^(\w+)(?:\(([^)]*)\))?(!)?:\s+(.+)$/;

/** A Conventional Commit subject as a change, or `undefined` for a subject that is not one. */
export function parseSubject(
  subject: string,
  breaking = false,
): Change | undefined {
  const match = SUBJECT.exec(subject.trim());
  if (!match) return undefined;
  return {
    type: match[1].toLowerCase(),
    scope: match[2] || undefined,
    description: match[4].trim(),
    breaking: breaking || match[3] === "!",
  };
}

/**
 * Reads the commits file a CI step wrote. A subject that is not a Conventional
 * Commit is left out, since it names no kind of change to bump by or list.
 */
export function readChanges(file: string): Change[] {
  if (!existsSync(file)) {
    throw new Error(`the commits file ${file} does not exist`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(
      `${file} is not readable JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${file} must be a JSON array of commit subjects, or of { "subject", "breaking"? } objects`,
    );
  }
  const changes: Change[] = [];
  for (const item of parsed) {
    const subject =
      typeof item === "string" ? item : Reflect.get(Object(item), "subject");
    if (typeof subject !== "string") {
      throw new Error(
        `${file} holds an item that is neither a subject string nor an object with a "subject": ${JSON.stringify(item)}`,
      );
    }
    const breaking =
      typeof item === "object" && Reflect.get(item, "breaking") === true;
    const change = parseSubject(subject, breaking);
    if (change) changes.push(change);
  }
  return changes;
}

/** The kinds of change that reach a release, in the order the changelog lists them. */
const SECTIONS: readonly (readonly [string, string])[] = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
];

/**
 * The bump the changes call for: a breaking change is major, a feature minor, a
 * fix or a performance change patch, and `undefined` when nothing in them
 * reaches a player (documentation, tests, build and the like).
 */
export function levelOf(changes: readonly Change[]): BumpLevel | undefined {
  if (changes.some((change) => change.breaking)) return "major";
  if (changes.some((change) => change.type === "feat")) return "minor";
  if (changes.some((change) => change.type === "fix" || change.type === "perf"))
    return "patch";
  return undefined;
}

/** The changelog section for one version, ending in a blank line. */
export function renderSection(
  version: string,
  date: string,
  changes: readonly Change[],
): string {
  const lines = [`## ${version} (${date})`, ""];
  const entry = (change: Change) => `- ${change.description}`;
  const breaking = changes.filter((change) => change.breaking);
  if (breaking.length > 0) {
    lines.push("### Breaking changes", "", ...breaking.map(entry), "");
  }
  for (const [type, title] of SECTIONS) {
    const own = changes.filter((c) => c.type === type && !c.breaking);
    if (own.length > 0) lines.push(`### ${title}`, "", ...own.map(entry), "");
  }
  return `${lines.join("\n")}\n`;
}

const CHANGELOG_HEADING = "# Changelog\n";

/**
 * Puts a section at the top of the Uplink's `CHANGELOG.md`, under its heading,
 * creating the file when there is none. A section for the version that is
 * already there is replaced rather than repeated, so running the same release
 * again does not stack two.
 */
export function prependSection(
  uplinkDir: string,
  version: string,
  section: string,
): void {
  const file = join(uplinkDir, "CHANGELOG.md");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const body = existing.startsWith(CHANGELOG_HEADING)
    ? existing.slice(CHANGELOG_HEADING.length).replace(/^\n+/, "")
    : existing;
  const heading = `## ${version} (`;
  const kept = body
    .split(/^(?=## )/m)
    .filter((part) => part !== "" && !part.startsWith(heading))
    .join("");
  writeFileSync(file, `${CHANGELOG_HEADING}\n${section}${kept}`);
}
