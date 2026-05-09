import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { NotesHostService } from "./NotesHostService";
import type { NotesSnapshot } from "./types";

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

export function useNotesHost(): NotesHostService {
  const svc = useContext(NotesHostContext);
  if (!svc) {
    throw new Error("useNotesHost must be used inside a <NotesHostProvider>");
  }
  return svc;
}

/** Reactive snapshot for React consumers. Re-renders on every host emit. */
export function useNotesHostSnapshot(): NotesSnapshot {
  const svc = useNotesHost();
  const [snap, setSnap] = useState(() => svc.snapshot());
  useEffect(() => svc.subscribe(setSnap), [svc]);
  return snap;
}
