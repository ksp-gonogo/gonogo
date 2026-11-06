/**
 * What an Uplink's own commits say about its next release: the bump they imply.
 *
 * The commits arrive as a file a CI step wrote after it had already picked out
 * the ones that touched this Uplink, so nothing here reads git. The file is a
 * JSON array whose items are either a commit subject, or an object holding the
 * subject and, when the commit footer carried a `BREAKING CHANGE`, `breaking:
 * true`.
 */

import { existsSync, readFileSync } from "node:fs";

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
