import { getUplinkHandle } from "@ksp-gonogo/sitrep-sdk";
import { useMemo, useSyncExternalStore } from "react";

/**
 * What an Uplink's handle may offer so the setup flow can show a problem only
 * its client can see from this browser, such as a sidecar it cannot reach.
 */
interface ClientNoteSource {
  readinessNote?: () => string | null;
  onReadinessNoteChange?: (cb: () => void) => () => void;
}

const SEPARATOR = "\u0000";

/**
 * The note each named Uplink's client reports, keyed by id, for the ids that
 * have one. Re-renders when any of them changes.
 */
export function useUplinkClientNotes(
  ids: readonly string[],
): ReadonlyMap<string, string> {
  const key = ids.join(SEPARATOR);
  const subscribe = useMemo(
    () => (cb: () => void) => {
      const unsubs = key
        .split(SEPARATOR)
        .filter((id) => id !== "")
        .map(
          (id) =>
            getUplinkHandle<ClientNoteSource>(id)?.onReadinessNoteChange?.(
              cb,
            ) ?? (() => {}),
        );
      return () => {
        for (const unsub of unsubs) unsub();
      };
    },
    [key],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    key
      .split(SEPARATOR)
      .filter((id) => id !== "")
      .map((id) => {
        const note = getUplinkHandle<ClientNoteSource>(id)?.readinessNote?.();
        return note ? `${id}${SEPARATOR}${note}` : "";
      })
      .filter((line) => line !== "")
      .join("\n"),
  );
  return useMemo(() => {
    const notes = new Map<string, string>();
    for (const line of snapshot.split("\n")) {
      const at = line.indexOf(SEPARATOR);
      if (at > 0) notes.set(line.slice(0, at), line.slice(at + 1));
    }
    return notes;
  }, [snapshot]);
}
