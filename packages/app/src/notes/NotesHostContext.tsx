import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { useHostCentre } from "../peer/HostCommandCentreAnnouncer";
import type { NotesHostService } from "./NotesHostService";
import { EMPTY_NOTES_SNAPSHOT, type NotesSnapshot } from "./types";

interface NotesHostValue {
  service: NotesHostService;
  /** Fixes the centre this screen reads; omitted, it follows the screen's own. */
  centreId: string | null | undefined;
}

const NotesHostContext = createContext<NotesHostValue | null>(null);

export function NotesHostProvider({
  service,
  centreId,
  children,
}: {
  service: NotesHostService;
  centreId?: string | null;
  children: ReactNode;
}) {
  return (
    <NotesHostContext.Provider value={{ service, centreId }}>
      {children}
    </NotesHostContext.Provider>
  );
}

export function useNotesHostOptional(): NotesHostService | null {
  return useContext(NotesHostContext)?.service ?? null;
}

/** The centre the main screen's notes belong to. */
export function useNotesCentre(): string | null {
  const own = useHostCentre();
  const fixed = useContext(NotesHostContext)?.centreId;
  return fixed === undefined ? own : fixed;
}

/**
 * Reactive snapshot of `svc`'s list for `centreId`, re-rendering when that
 * list changes or the centre moves. With no host or no centre there is
 * nothing to show, so it reads as no notes.
 */
export function useNotesHostSnapshot(
  svc: NotesHostService | null,
  centreId: string | null,
): NotesSnapshot {
  const [snap, setSnap] = useState<NotesSnapshot>(
    () => svc?.snapshot(centreId) ?? EMPTY_NOTES_SNAPSHOT,
  );
  useEffect(() => {
    if (!svc) return;
    setSnap(svc.snapshot(centreId));
    return svc.subscribe((next) => {
      if (next.centreId === centreId) setSnap(next);
    });
  }, [svc, centreId]);
  if (svc === null || centreId === null) return EMPTY_NOTES_SNAPSHOT;
  return snap.centreId === centreId ? snap : svc.snapshot(centreId);
}
