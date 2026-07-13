import type { ComponentProps, DataKey } from "@ksp-gonogo/core";
import { registerComponent, useScreen } from "@ksp-gonogo/core";
import {
  isTopicCarried,
  mapTopic,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  Panel,
  PanelTitle,
  PrimaryButton,
  ScrollArea,
} from "@ksp-gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { usePeerClient } from "../peer/PeerClientContext";
import { NotesClientService } from "./NotesClientService";
import { useNotesHostOptional, useNotesHostSnapshot } from "./NotesHostContext";
import { TagAutocomplete } from "./TagAutocomplete";
import { extractTags, renderTemplate } from "./templating";
import type { Note, NotesSnapshot } from "./types";

// ── Component ───────────────────────────────────────────────────────────────

interface NotesActions {
  addNote: (body: string) => void;
  updateNote: (id: string, body: string) => void;
  deleteNote: (id: string) => void;
  reorderNote: (id: string, afterId: string | null) => void;
}

function NotesComponent(_props: Readonly<ComponentProps>) {
  const screen = useScreen();
  if (screen === "station") return <StationView />;
  return <MainView />;
}

function MainView() {
  const host = useNotesHostOptional();
  const snap = useNotesHostSnapshot();
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

function NotesView({
  snap,
  actions,
}: Readonly<{ snap: NotesSnapshot; actions: NotesActions }>) {
  const [draft, setDraft] = useState("");
  const ordered = useMemo(
    () => [...snap.notes].sort((a, b) => a.order - b.order),
    [snap.notes],
  );
  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    actions.addNote(body);
    setDraft("");
  };
  return (
    <Panel>
      <PanelTitle>NOTES</PanelTitle>
      <List>
        {ordered.length === 0 ? (
          <Empty>No notes yet — add one below.</Empty>
        ) : (
          ordered.map((note, idx) => (
            <NoteRow
              key={note.id}
              note={note}
              isFirst={idx === 0}
              isLast={idx === ordered.length - 1}
              prevId={idx > 0 ? ordered[idx - 1].id : null}
              nextId={idx < ordered.length - 1 ? ordered[idx + 1].id : null}
              actions={actions}
            />
          ))
        )}
      </List>
      <AddRow>
        <TagAutocomplete
          ariaLabel="New note body (use {{ to insert a variable)"
          placeholder="New note... type {{ to insert a variable"
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <PrimaryButton type="button" onClick={submit} disabled={!draft.trim()}>
          Add
        </PrimaryButton>
      </AddRow>
    </Panel>
  );
}

function NoteRow({
  note,
  isFirst,
  isLast,
  prevId,
  nextId,
  actions,
}: Readonly<{
  note: Note;
  isFirst: boolean;
  isLast: boolean;
  prevId: string | null;
  nextId: string | null;
  actions: NotesActions;
}>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  // Keep the editor draft in sync if a different device edits this note
  // while we're not currently editing it locally.
  useEffect(() => {
    if (!editing) setDraft(note.body);
  }, [note.body, editing]);

  const commit = () => {
    if (draft.trim() && draft !== note.body) {
      actions.updateNote(note.id, draft);
    } else {
      setDraft(note.body);
    }
    setEditing(false);
  };

  return (
    <Item>
      <ReorderColumn>
        <ReorderBtn
          type="button"
          aria-label="Move up"
          disabled={isFirst}
          onClick={() => {
            // Move up = swap with previous neighbour. Implemented by
            // moving the *previous* note to land after this one.
            if (prevId === null) return;
            actions.reorderNote(prevId, note.id);
          }}
        >
          <ChevronUpIcon size={12} />
        </ReorderBtn>
        <ReorderBtn
          type="button"
          aria-label="Move down"
          disabled={isLast}
          onClick={() => {
            // Move down = land this note after its current next
            // neighbour.
            if (nextId === null) return;
            actions.reorderNote(note.id, nextId);
          }}
        >
          <ChevronDownIcon size={12} />
        </ReorderBtn>
      </ReorderColumn>
      <Body>
        {editing ? (
          <TagAutocomplete
            multiline
            value={draft}
            onChange={setDraft}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(note.body);
                setEditing(false);
              }
            }}
          />
        ) : (
          <RenderedBody onClick={() => setEditing(true)}>
            <NoteRenderedText body={note.body} />
          </RenderedBody>
        )}
      </Body>
      <RowActions>
        <DoneBtn
          type="button"
          aria-label="Mark note done"
          onClick={() => actions.deleteNote(note.id)}
        >
          <CheckIcon size={14} />
        </DoneBtn>
        <DeleteBtn
          type="button"
          aria-label="Delete note"
          onClick={() => actions.deleteNote(note.id)}
        >
          <CloseIcon size={12} />
        </DeleteBtn>
      </RowActions>
    </Item>
  );
}

function NoteRenderedText({ body }: Readonly<{ body: string }>) {
  // Subscribe to every tag the body mentions so the rendered output updates
  // when any of them change. useDataValue is stable per-key so the hook
  // count is constant per render of this component instance, even if the
  // body is edited — the call list only changes when the *set of tags*
  // changes, which is rare.
  const tags = useMemo(() => extractTags(body), [body]);
  const valueMap = useTagValues(tags);
  const knownKeys = useKnownDataKeys();
  const text = useMemo(
    () => renderTemplate(body, (k) => valueMap.get(k), { knownKeys }),
    [body, valueMap, knownKeys],
  );
  return <>{text}</>;
}

/**
 * Legacy source id `mapTopic` uses to resolve a `{{v.altitude}}`-style tag
 * onto its stream `Topic` — no `DataSource` is registered under this id any
 * more (deleted alongside `dataSources/telemachus.ts`), but `map-topic.ts`'s
 * migration table survives P4c-b as the live stream router (see its own
 * doc comment), so this id is still the correct lookup key.
 */
const LEGACY_DATA_SOURCE_ID = "data";

/**
 * Set of keys known to the legacy `data` source. The `DataSource` itself is
 * gone (deleted alongside `dataSources/telemachus.ts`), so this always
 * returns an empty set — `renderTemplate`'s empty-set fall-through treats
 * that as "don't flag unknown tags" rather than crashing, so autocomplete
 * degrades to always-trusting instead of validating against a live schema.
 */
function useKnownDataKeys(): ReadonlySet<string> {
  return useMemo(() => new Set<string>(), []);
}

/**
 * Reads the latest value of every tag, one Topic per note-body placeholder
 * (`{{v.altitude}}`-style). Forces a re-render whenever any of them change.
 *
 * Mirrors `useTelemetry`'s own per-key migration-shim decision (`@ksp-gonogo/core`)
 * — mapped + a `TelemetryProvider` mounted + carried -> the `TimelineStore`;
 * otherwise the legacy `DataSource` — but resolved imperatively for a
 * DYNAMIC tag list instead of one fixed hook call, since a `useTelemetry`
 * loop would change hook count as the tag list grows/shrinks mid-edit.
 */
function useTagValues(tags: readonly string[]): Map<string, unknown> {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();
  const [snapshot, setSnapshot] = useState<Map<string, unknown>>(
    () => new Map(),
  );

  useEffect(() => {
    const next = new Map<string, unknown>();
    const unsubs: Array<() => void> = [];
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      setSnapshot(new Map(next));
    };
    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      // Microtask coalesce — many tags can update in the same tick; one
      // re-render per flush is enough.
      queueMicrotask(flush);
    };

    for (const tag of tags) {
      const topic = mapTopic(LEGACY_DATA_SOURCE_ID, tag);
      const carried =
        store !== undefined &&
        topic !== undefined &&
        carriedChannels !== undefined &&
        isTopicCarried(store, carriedChannels, topic);

      if (client && store && topic !== undefined && carried) {
        const inputTopics = store.resolveSubscriptionTopics(topic);
        const unsubscribeInputs = inputTopics.map((inputTopic) =>
          client.subscribe(inputTopic, () => {}),
        );
        const unsubscribeFrame = store.subscribeFrame(() => {
          const point = store.sample(topic, store.currentFrame());
          next.set(tag, point ? point.payload : undefined);
          scheduleFlush();
        });
        unsubs.push(() => {
          unsubscribeFrame();
          for (const unsubscribe of unsubscribeInputs) unsubscribe();
        });
      }
      // No `else` branch — the legacy `DataSource` this used to fall back
      // to for un-carried tags is gone. An un-mapped or un-carried tag
      // simply never resolves (stays `undefined`), same as any other
      // never-arrived value.
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [tags, client, store, carriedChannels]);
  return snapshot;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const List = styled(ScrollArea)`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Item = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: start;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
`;

const ReorderColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const ReorderBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 1px 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  @media (hover: hover) {
    &:not(:disabled):hover {
      color: var(--color-text-primary);
    }
  }
`;

const Body = styled.div`
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-primary);
  word-wrap: break-word;
`;

const RenderedBody = styled.div`
  cursor: text;
  white-space: pre-wrap;
  padding: 2px 0;
`;

const RowActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
`;

const DoneBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 1px 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  @media (hover: hover) {
    &:hover {
      color: var(--color-status-go-fg);
    }
  }
`;

const DeleteBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 1px 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  @media (hover: hover) {
    &:hover {
      color: var(--color-status-nogo-fg);
    }
  }
`;

const AddRow = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-shrink: 0;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: 11px;
  padding: 12px;
  text-align: center;
`;

// ── Registration ────────────────────────────────────────────────────────────

const NOTES_DATA_REQUIREMENTS: DataKey["key"][] = [];

registerComponent({
  id: "notes",
  name: "Notes",
  description:
    "Mission notes synced across all screens. Use {{key.path}} to embed live telemetry — values update as the data feed ticks.",
  tags: ["mission-control"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 4 },
  component: NotesComponent,
  // Tags are dynamic per-note; we subscribe to whatever the body mentions
  // at render time rather than declaring fixed dataRequirements upfront.
  dataRequirements: NOTES_DATA_REQUIREMENTS,
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { NotesComponent };
