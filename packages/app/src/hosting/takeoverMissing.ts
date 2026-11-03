const NOTES_KEY = "gonogo.notes.v2";
const ALARMS_KEY = "gonogo.alarms.list";
const THREAD_PREFIX = "gonogo.commcast.v4.";

function readable(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Whether `key` holds a list, or a record of lists, with something in it. */
function holdsList(storage: Storage, key: string): boolean {
  const raw = readable(storage, key);
  if (raw === null) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (typeof parsed === "object" && parsed !== null) {
      return Object.values(parsed).some(
        (v) => Array.isArray(v) && v.length > 0,
      );
    }
  } catch {
    /* unreadable: nothing held */
  }
  return false;
}

function holdsThread(storage: Storage): boolean {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(THREAD_PREFIX) && holdsList(storage, key)) return true;
  }
  return false;
}

/**
 * What a screen that has just taken over as host does not have from the host
 * before it, in the order the notice names them.
 *
 * A host keeps notes, alarms and the thread in its browser's storage, so a
 * screen in the same browser as the old host already holds them and a screen
 * anywhere else does not. GO/NO-GO votes are never kept, and an alarm on the
 * game's own clock comes back from the game, so neither question depends on
 * the browser.
 */
export function missingAfterTakeover(
  storage: Storage | undefined = globalThis.localStorage,
): string[] {
  const missing: string[] = [];
  if (!storage || !holdsList(storage, NOTES_KEY)) missing.push("notes");
  if (!storage || !holdsThread(storage)) missing.push("the thread");
  if (!storage || !holdsList(storage, ALARMS_KEY)) {
    missing.push("alarms that are not on the game's clock");
  }
  missing.push("GO/NO-GO votes");
  return missing;
}

/** The items joined as a sentence would list them: "a, b and c". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
