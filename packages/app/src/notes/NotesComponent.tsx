import type { ComponentProps, DataKey } from "@ksp-gonogo/core";
import { registerComponent, useScreen } from "@ksp-gonogo/core";
import { useEffect, useState } from "react";
import { usePeerClient } from "../peer/PeerClientContext";
import { NotesClientService } from "./NotesClientService";
import { useNotesHostOptional, useNotesHostSnapshot } from "./NotesHostContext";
import { type NotesActions, NotesView } from "./NotesView";
import { Empty } from "./notesStyles";
import type { NotesSnapshot } from "./types";

function NotesComponent(_props: Readonly<ComponentProps>) {
  // The host owns the canonical list and every other screen mirrors it over the peer mesh; a pilot page is a mesh client too.
  const screen = useScreen();
  if (screen !== "main") return <StationView />;
  return <MainView />;
}

function MainView() {
  const host = useNotesHostOptional();
  const snap = useNotesHostSnapshot(host);
  if (!host) return <Empty>Notes host unavailable</Empty>;
  const actions: NotesActions = {
    addNote: (body) => host.addNote({ body }),
    updateNote: (id, body) => host.updateNote(id, body),
    deleteNote: (id) => host.deleteNote(id),
    reorderNote: (id, afterId) => host.reorderNote(id, afterId),
  };
  return <NotesView snap={snap} actions={actions} />;
}

function StationView() {
  const client = usePeerClient();
  const [service] = useState(() =>
    client ? new NotesClientService(client) : null,
  );
  const [snap, setSnap] = useState<NotesSnapshot>(
    () => service?.snapshot() ?? { notes: [] },
  );
  useEffect(() => service?.subscribe(setSnap), [service]);
  if (!client || !service) return <Empty>Waiting for host connection...</Empty>;
  const actions: NotesActions = {
    addNote: (body) => service.addNote(body),
    updateNote: (id, body) => service.updateNote(id, body),
    deleteNote: (id) => service.deleteNote(id),
    reorderNote: (id, afterId) => service.reorderNote(id, afterId),
  };
  return <NotesView snap={snap} actions={actions} />;
}

// Tags are dynamic per note, so the widget subscribes to whatever a body mentions rather than declaring requirements upfront.
const NOTES_DATA_REQUIREMENTS: DataKey["key"][] = [];

registerComponent({
  id: "notes",
  name: "Notes",
  description:
    "Mission notes synced across all screens. Use {{key.path}} to embed live telemetry, values update as the data feed ticks.",
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
