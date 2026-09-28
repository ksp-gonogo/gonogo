import { Button, Panel, Section } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { NoteRow } from "./NoteRow";
import { AddRow, Empty } from "./notesStyles";
import { TagAutocomplete } from "./TagAutocomplete";
import type { NotesSnapshot } from "./types";

export interface NotesActions {
  addNote: (body: string) => void;
  updateNote: (id: string, body: string) => void;
  deleteNote: (id: string) => void;
  reorderNote: (id: string, afterId: string | null) => void;
}

export function NotesView({
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
      /* The composer is PINNED by Panel rather than merely rendered last. */
      panelFooter={
        <AddRow>
          <TagAutocomplete
            ariaLabel="New note body (use {{ to insert a variable)"
            placeholder="New note"
            value={draft}
            onChange={setDraft}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              submit();
            }}
          />
          <Button
            variant="primary"
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
          >
            Add
          </Button>
        </AddRow>
      }
      /* One section: the notes are one hand-ordered list, so columns would fight the order the reorder buttons set. */
      sections={
        <Section full gap="section-compact">
          {ordered.length === 0 ? (
            <Empty>No notes yet. Type {"{{"} for live data</Empty>
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
