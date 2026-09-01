import type { ComponentProps, DataKey } from "@ksp-gonogo/core";
import { registerComponent, useScreen } from "@ksp-gonogo/core";
import {
  resolveValueTopic,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  Panel,
  PrimaryButton,
  Section,
} from "@ksp-gonogo/ui-kit";
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
    <Panel
      panelTitle="NOTES"
      /* The composer is PINNED by Panel rather than merely rendered last. It
         used to sit after a `flex: 1` ScrollArea, which is what held it at the
         bottom; inside a section it would scroll away with the notes. */
      panelFooter={
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
          <PrimaryButton
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
          >
            Add
          </PrimaryButton>
        </AddRow>
      }
      /* ONE section: the notes are one ordered list an operator reorders by
         hand, so columns would fight the order the reorder buttons set. */
      sections={
        <Section full gap="lg">
          {ordered.length === 0 ? (
            <Empty>No notes yet: add one below.</Empty>
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
        </Section>
      }
    />
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
  // body is edited, the call list only changes when the *set of tags*
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
 * Source id the tag resolver passes when resolving a `{{...}}` tag
 * onto its stream `Topic`: no `DataSource` is registered under this id any
 * more (the legacy source module is deleted), but `map-topic.ts`'s
 * migration table survives P4c-b as the live stream router (see its own
 * doc comment), so this id is still the correct lookup key.
 */
const LEGACY_DATA_SOURCE_ID = "data";

/**
 * Set of keys known to the legacy `data` source. The `DataSource` itself is
 * gone (the legacy source module is deleted), so this always
 * returns an empty set: `renderTemplate`'s empty-set fall-through treats
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
 * Resolved imperatively for a DYNAMIC tag list rather than as one fixed hook
 * call, since a `useTelemetry` loop would change hook count as the tag list
 * grows and shrinks mid-edit.
 *
 * This is `useTelemetry`'s CANONICAL shape, not its migration shim: there is no
 * legacy `DataSource` here to fall back to, as `LEGACY_DATA_SOURCE_ID`'s own
 * doc above says. It carried the shim's carried-channels gate anyway, which
 * with no fallback to pick could only ever suppress: a tag on an uncarried
 * topic never subscribed, so it rendered nothing for ever, and
 * `installUnownedTopicWarning` could not report it because it only hears about
 * topics something subscribed to. The gate is gone; a tag resolves whenever its
 * topic does, and one that nothing publishes is now named by that warning.
 *
 * Exported for its own test: this resolution is where the silence lived, and
 * reaching it through the component costs a notes-host and screen fixture that
 * would test neither.
 */
export function useTagValues(tags: readonly string[]): Map<string, unknown> {
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
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
      // Microtask coalesce: many tags can update in the same tick; one
      // re-render per flush is enough.
      queueMicrotask(flush);
    };

    for (const tag of tags) {
      const topic = resolveValueTopic(LEGACY_DATA_SOURCE_ID, tag);

      if (client && store && topic !== undefined) {
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
      // No `else` branch, because there is no fallback source. A tag naming no
      // topic at all simply never resolves (stays `undefined`), same as any
      // other never-arrived value.
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, [tags, client, store]);
  return snapshot;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const Item = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-8);
  align-items: start;
  padding: var(--space-6) var(--space-8);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
`;

const ReorderColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
`;

const ReorderBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: var(--space-hair) var(--space-2);
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
  font-size: var(--font-size-sm);
  line-height: var(--line-height-body);
  color: var(--color-text-primary);
  word-wrap: break-word;
`;

const RenderedBody = styled.div`
  cursor: text;
  white-space: pre-wrap;
  padding: var(--space-2) 0;
`;

const RowActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: center;
`;

const DoneBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: var(--space-hair) var(--space-2);
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
  padding: var(--space-hair) var(--space-2);
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
  gap: var(--space-6);
  flex-shrink: 0;
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  padding: var(--space-12);
  text-align: center;
`;

// ── Registration ────────────────────────────────────────────────────────────

const NOTES_DATA_REQUIREMENTS: DataKey["key"][] = [];

registerComponent({
  id: "notes",
  name: "Notes",
  description:
    "Mission notes synced across all screens. Use {{key.path}} to embed live telemetry, values update as the data feed ticks.",
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
