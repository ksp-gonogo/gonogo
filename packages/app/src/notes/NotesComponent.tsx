import type { ComponentProps, DataKey } from "@ksp-gonogo/core";
import { registerComponent, useScreen } from "@ksp-gonogo/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePeerClient } from "../peer/PeerClientContext";
import { NotesClientService } from "./NotesClientService";
import {
  useNotesCentre,
  useNotesHostOptional,
  useNotesHostSnapshot,
} from "./NotesHostContext";
import type { NoteResult } from "./NotesHostService";
import { type NotesActions, NotesView } from "./NotesView";
import { Empty } from "./notesStyles";
import type { NoteOutcome, NotesSnapshot } from "./types";

const NO_CENTRE = "No command centre chosen yet";
const NOT_CONNECTED = "Not connected to the main screen";

const OK: Promise<NoteOutcome> = Promise.resolve({ status: "ok" });

function NotesComponent(_props: Readonly<ComponentProps>) {
  // The host owns the canonical lists and every other screen mirrors the one for its centre over the peer mesh; a pilot page is a mesh client too.
  const screen = useScreen();
  if (screen !== "main") return <StationView />;
  return <MainView />;
}

function MainView() {
  const host = useNotesHostOptional();
  const centreId = useNotesCentre();
  const snap = useNotesHostSnapshot(host, centreId);
  if (!host) return <Empty>Notes host unavailable</Empty>;
  const actions: NotesActions = {
    addNote: (body) => {
      if (centreId !== null) host.addNote(centreId, { body });
      return OK;
    },
    updateNote: (id, body, v) =>
      settled(centreId, (c) => host.updateNote(c, id, body, v)),
    deleteNote: (id, v) => settled(centreId, (c) => host.deleteNote(c, id, v)),
    reorderNote: (id, afterId, v) =>
      settled(centreId, (c) => host.reorderNote(c, id, afterId, v)),
  };
  return (
    <NotesView
      snap={snap}
      actions={actions}
      blockedReason={centreId === null ? NO_CENTRE : null}
    />
  );
}

function settled(
  centreId: string | null,
  run: (centreId: string) => NoteResult,
): Promise<NoteOutcome> {
  if (centreId === null) return Promise.resolve({ status: "offline" });
  const result = run(centreId);
  return Promise.resolve(
    result.ok
      ? { status: "ok" }
      : { status: "refused", current: result.current },
  );
}

function StationView() {
  const client = usePeerClient();
  const [service] = useState(() =>
    client ? new NotesClientService(client) : null,
  );
  const [snap, setSnap] = useState<NotesSnapshot>(
    () => service?.snapshot() ?? { centreId: null, notes: [] },
  );
  useEffect(() => service?.subscribe(setSnap), [service]);
  const connected = useSyncExternalStore(
    (notify) => client?.onConnectionStatus(notify) ?? (() => {}),
    () => client?.getConnStatus() === "connected",
  );
  if (!client || !service) return <Empty>Waiting for host connection...</Empty>;
  const actions: NotesActions = {
    addNote: (body) => service.addNote(body),
    updateNote: (id, body, v) => service.updateNote(id, body, v),
    deleteNote: (id, v) => service.deleteNote(id, v),
    reorderNote: (id, afterId, v) => service.reorderNote(id, afterId, v),
  };
  return (
    <NotesView
      snap={snap}
      actions={actions}
      blockedReason={stationBlockedReason(connected, snap)}
    />
  );
}

function stationBlockedReason(
  connected: boolean,
  snap: NotesSnapshot,
): string | null {
  if (!connected) return NOT_CONNECTED;
  if (snap.centreId === null) return NO_CENTRE;
  return null;
}

// Tags are dynamic per note, so the widget subscribes to whatever a body mentions rather than declaring requirements upfront.
const NOTES_DATA_REQUIREMENTS: DataKey["key"][] = [];

registerComponent({
  id: "notes",
  name: "Notes",
  description:
    "Mission notes shared by the screens at one command centre. Use {{key.path}} to embed live telemetry, values update as the data feed ticks.",
  tags: ["mission-control"],
  defaultSize: { w: 6, h: 8 },
  // Six columns so the composer's field has room beside the Add button; five rows because four cannot show one note.
  minSize: { w: 6, h: 5 },
  component: NotesComponent,
  dataRequirements: NOTES_DATA_REQUIREMENTS,
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { NotesComponent };
