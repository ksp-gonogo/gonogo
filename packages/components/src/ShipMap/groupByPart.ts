import type { Contributed } from "@ksp-gonogo/core";

/**
 * Groups contribution entries by `partId`, first-wins on `dedupeKey`.
 * `useContributions` returns entries in priority order, so first is the
 * highest-priority contributor.
 */
export function groupByPart<Entry extends { partId: string }>(
  entries: readonly Contributed<Entry>[],
  dedupeKey: (entry: Entry) => string,
): Map<string, Entry[]> {
  const seen = new Set<string>();
  const out = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = dedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(entry.partId);
    if (list) list.push(entry);
    else out.set(entry.partId, [entry]);
  }
  return out;
}
