import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { NotesHostService } from "./NotesHostService";
import { EMPTY_NOTES_SNAPSHOT, type NotesSnapshot } from "./types";

const NotesHostContext = createContext<NotesHostService | null>(null);

export function NotesHostProvider({
  service,
  children,
}: {
  service: NotesHostService;
  children: ReactNode;
}) {
  return (
    <NotesHostContext.Provider value={service}>
      {children}
    </NotesHostContext.Provider>
  );
}

export function useNotesHostOptional(): NotesHostService | null {
  return useContext(NotesHostContext);
}

/**
 * Reactive snapshot of `svc` for React consumers, re-rendering on every host
 * emit. With no host there is nothing to mirror, so it reads as no notes.
 */
export function useNotesHostSnapshot(
  svc: NotesHostService | null,
): NotesSnapshot {
  const [snap, setSnap] = useState<NotesSnapshot>(
    () => svc?.snapshot() ?? EMPTY_NOTES_SNAPSHOT,
  );
  useEffect(() => svc?.subscribe(setSnap), [svc]);
  return svc === null ? EMPTY_NOTES_SNAPSHOT : snap;
}
