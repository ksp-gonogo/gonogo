import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
} from "@ksp-gonogo/ui-kit";
import { type KeyboardEvent, useEffect, useState } from "react";
import { NoteRenderedText } from "./NoteRenderedText";
import type { NotesActions } from "./NotesView";
import {
  Body,
  DeleteBtn,
  DoneBtn,
  Item,
  RenderedBody,
  ReorderBtn,
  ReorderColumn,
  RowActions,
} from "./notesStyles";
import { TagAutocomplete } from "./TagAutocomplete";
import type { Note } from "./types";

export function NoteRow({
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
  // Keep the editor draft in sync if a different device edits this note while we're not currently editing it locally.
  useEffect(() => {
    if (!editing) setDraft(note.body);
  }, [note.body, editing]);

  const saveDraft = () => {
    if (draft.trim() && draft !== note.body) {
      actions.updateNote(note.id, draft);
      return;
    }
    setDraft(note.body);
  };
  const commit = () => {
    saveDraft();
    setEditing(false);
  };

  const onEditorKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key !== "Escape") return;
    e.preventDefault();
    setDraft(note.body);
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
            // Moving up lands the previous note after this one.
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
            onKeyDown={onEditorKeyDown}
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
          <CheckIcon size="var(--icon-size-control)" />
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
