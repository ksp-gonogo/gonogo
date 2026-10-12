import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

/** Beside the pictures: the names of the files the last run wrote, which are the only ones a run may delete. */
export const RENDERED_FILES_RECORD = ".uplink-tools-renders.json";

/** The file names a previous run recorded in `dir`, or none when it recorded nothing or the record is unreadable. */
export function recordedRenders(dir: string): string[] {
  const path = join(dir, RENDERED_FILES_RECORD);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter(
          (name): name is string =>
            typeof name === "string" && name === basename(name),
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Deletes the pictures an earlier run recorded in `dir`, so a removed scene
 * leaves no orphan, and returns the recorded names that stay. With `scene`
 * only that scene's pictures go, since a run of one scene redraws nothing else.
 * A file the record does not name is never touched.
 */
export async function removeRecordedRenders(
  dir: string,
  scene?: string,
): Promise<string[]> {
  const kept: string[] = [];
  for (const name of recordedRenders(dir)) {
    if (scene !== undefined && !name.startsWith(`${scene}--`)) {
      kept.push(name);
      continue;
    }
    await rm(join(dir, name), { force: true });
  }
  return kept;
}

/** Records `names` as the files this tool wrote in `dir`. */
export function recordRenders(dir: string, names: readonly string[]): void {
  writeFileSync(
    join(dir, RENDERED_FILES_RECORD),
    `${JSON.stringify([...new Set(names)].sort(), null, 2)}\n`,
  );
}
