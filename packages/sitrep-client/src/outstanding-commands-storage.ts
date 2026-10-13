import {
  OUTSTANDING_COMMAND_CAP,
  type OutstandingCommand,
  type OutstandingCommandStore,
} from "@ksp-gonogo/sitrep-sdk/spine";

const STORAGE_PREFIX = "gonogo.sitrep.outstandingCommands.v1.";

function isOutstanding(value: unknown): value is OutstandingCommand {
  if (typeof value !== "object" || value === null) return false;
  const held = value as Partial<OutstandingCommand>;
  return (
    typeof held.requestId === "string" &&
    typeof held.command === "string" &&
    typeof held.label === "string" &&
    (held.replyDueUt === undefined || Number.isFinite(held.replyDueUt))
  );
}

/**
 * Keeps the commands one screen still waits on in this browser's local
 * storage under `screenKey`, so a page reload on that screen can claim their
 * answers from the mod. Each screen has its own list: two tabs of the same
 * app on different screens never claim each other's commands.
 *
 * Reads and writes fail soft: a blocked or full store costs the reload claim
 * and nothing else.
 */
export function localStorageOutstandingCommands(
  screenKey: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): OutstandingCommandStore {
  const key = STORAGE_PREFIX + screenKey;
  return {
    read() {
      try {
        const raw = storage.getItem(key);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isOutstanding).slice(-OUTSTANDING_COMMAND_CAP);
      } catch {
        return [];
      }
    },
    write(commands) {
      try {
        if (commands.length === 0) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(commands));
      } catch {
        /* Nothing to do: see the function's doc. */
      }
    },
  };
}
