import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  useTooltip,
} from "@ksp-gonogo/ui-kit";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { NoteRenderedText } from "./NoteRenderedText";
import type { NotesActions } from "./NotesView";
import {
  Body,
  DeleteBtn,
  EditorSlot,
  Item,
  RenderedBody,
  ReorderBtn,
  ReorderColumn,
  RowActions,
} from "./notesStyles";
import { TagAutocomplete } from "./TagAutocomplete";
import type { Note } from "./types";

/** Why an open edit has not been saved, while the operator keeps what they typed. */
type Hold = "changed" | "deleted" | "offline" | "refused";

const HOLD_TIP: Record<Hold, string> = {
  changed: "Changed elsewhere. Enter keeps yours, Escape takes theirs",
  deleted: "Deleted elsewhere. Enter adds it again, Escape drops it",
  offline:
    "Not sent, not connected to the main screen. Enter tries again, Escape drops your edit",
  refused:
    "Not added, this screen has no command centre. Enter tries again, Escape drops your edit",
};

export function NoteRow({
  note,
  isFirst,
  isLast,
  prevNote,
  nextNote,
  blocked,
  actions,
  gone,
  onUnsaved,
}: Readonly<{
  note: Note;
  isFirst: boolean;
  isLast: boolean;
  prevNote: Note | null;
  nextNote: Note | null;
  /** Edits are switched off while this is true. */
  blocked: boolean;
  actions: NotesActions;
  /** True when the list no longer holds this note and only the open edit keeps the row. */
  gone: boolean;
  /** Reports the note while its open editor holds text the list does not, and null otherwise. */
  onUnsaved: (id: string, note: Note | null) => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [heldFor, setHold] = useState<Hold | null>(null);
  const hold = heldFor ?? (gone ? "deleted" : null);
  const [deleteHeld, setDeleteHeld] = useState(false);
  // The editor's delayed blur can fire after it has closed; a closed editor sends nothing.
  const open = useRef(false);
  // Keep the editor draft in sync if a different device edits this note while we're not currently editing it locally.
  useEffect(() => {
    if (!editing) setDraft(note.body);
  }, [note.body, editing]);

  const unsaved = editing && draft !== note.body;
  useEffect(() => {
    onUnsaved(note.id, unsaved ? note : null);
  }, [unsaved, note, onUnsaved]);

  const editorTip = useTooltip(hold ? HOLD_TIP[hold] : null);
  const deleteTip = useTooltip(
    deleteHeld ? "Changed elsewhere. Press again to delete" : null,
  );

  const close = () => {
    open.current = false;
    setHold(null);
    setEditing(false);
  };
  const submit = async () => {
    if (!open.current) return;
    if (gone || hold === "deleted") {
      if (!draft.trim()) return discard();
      const outcome = await actions.addNote(draft);
      if (outcome.status === "ok") close();
      else setHold(outcome.status === "offline" ? "offline" : "refused");
      return;
    }
    if (!draft.trim() || draft === note.body) {
      setDraft(note.body);
      close();
      return;
    }
    const outcome = await actions.updateNote(note.id, draft, note.version);
    if (outcome.status === "ok") return close();
    if (outcome.status === "offline") return setHold("offline");
    setHold(outcome.current === null ? "deleted" : "changed");
  };
  const discard = () => {
    setDraft(note.body);
    close();
  };

  const onEditorKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key !== "Escape") return;
    e.preventDefault();
    discard();
  };

  return (
    <Item>
      <ReorderColumn>
        <ReorderBtn
          type="button"
          aria-label="Move up"
          disabled={isFirst || blocked || gone}
          onClick={() => {
            // Moving up lands the previous note after this one.
            if (prevNote === null) return;
            void actions.reorderNote(prevNote.id, note.id, prevNote.version);
          }}
        >
          <ChevronUpIcon size={12} />
        </ReorderBtn>
        <ReorderBtn
          type="button"
          aria-label="Move down"
          disabled={isLast || blocked || gone}
          onClick={() => {
            if (nextNote === null) return;
            void actions.reorderNote(note.id, nextNote.id, note.version);
          }}
        >
          <ChevronDownIcon size={12} />
        </ReorderBtn>
      </ReorderColumn>
      <Body>
        {editing ? (
          <EditorSlot $stuck={hold !== null} {...editorTip.anchor}>
            <TagAutocomplete
              multiline
              autoFocus
              invalid={hold !== null}
              value={draft}
              onChange={setDraft}
              // A held edit stays open: leaving the field must not send it again or lose it.
              onBlur={hold === null ? () => void submit() : undefined}
              onKeyDown={onEditorKeyDown}
            />
            {editorTip.tip}
          </EditorSlot>
        ) : (
          <RenderedBody
            type="button"
            disabled={blocked}
            onClick={() => {
              open.current = true;
              setEditing(true);
            }}
          >
            <NoteRenderedText body={note.body} />
          </RenderedBody>
        )}
      </Body>
      <RowActions>
        <DeleteBtn
          type="button"
          aria-label="Delete note"
          aria-invalid={deleteHeld || undefined}
          disabled={blocked || gone}
          {...deleteTip.anchor}
          onClick={async () => {
            const outcome = await actions.deleteNote(note.id, note.version);
            setDeleteHeld(
              outcome.status === "refused" && outcome.current !== null,
            );
          }}
        >
          <CloseIcon size={12} />
        </DeleteBtn>
        {deleteTip.tip}
      </RowActions>
    </Item>
  );
}
