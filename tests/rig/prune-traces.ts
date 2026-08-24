import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Keeps the trace directory from becoming a slow leak.
 *
 * <p>A rig session traces unconditionally, and an always-on trace of a run that
 * waits several minutes on a real game is tens of megabytes. Nothing prompts
 * anyone to clear them: they live under gitignored `local_docs/`, so they never
 * show up in a diff, never fail a check, and are noticed for the first time when
 * a disk fills.</p>
 *
 * <p>Two rules rather than one, because either alone leaves a hole. A count cap
 * keeps a busy week bounded; an age cap clears out a directory nobody has run in
 * for a month, which a count cap would keep forever.</p>
 */
const TRACE_DIR = "local_docs/traces";
const KEEP_NEWEST = 10;
const MAX_AGE_DAYS = 14;

export default async function pruneTraces(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(TRACE_DIR);
  } catch {
    // No directory yet: the first run makes it. Not an error.
    return;
  }

  const dated: Array<{ path: string; modified: number }> = [];
  for (const entry of entries) {
    const path = join(TRACE_DIR, entry);
    try {
      dated.push({ path, modified: (await stat(path)).mtimeMs });
    } catch {
      // Vanished between the listing and the stat. Nothing to prune.
    }
  }

  // Newest first, so the slice below keeps the newest and drops the rest.
  dated.sort((a, b) => b.modified - a.modified);
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const doomed = dated.filter(
    (entry, index) => index >= KEEP_NEWEST || entry.modified < cutoff,
  );

  for (const entry of doomed) {
    await rm(entry.path, { recursive: true, force: true });
  }
  if (doomed.length > 0) {
    // Said out loud. A prune that ran silently would be indistinguishable from
    // one that never ran, and the first time anyone checks is after losing
    // something they wanted.
    console.log(
      `rig: pruned ${doomed.length} trace(s), keeping the newest ${Math.min(
        KEEP_NEWEST,
        dated.length - doomed.length,
      )}`,
    );
  }
}
