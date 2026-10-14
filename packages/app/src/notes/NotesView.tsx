import { Button, Panel, Section, useTooltip } from "@ksp-gonogo/ui-kit";
import { useMemo, useState } from "react";
import { NoteRow } from "./NoteRow";
import { AddRow, Empty, Field } from "./notesStyles";
import { TagAutocomplete } from "./TagAutocomplete";
import type { NoteOutcome, NotesSnapshot } from "./types";

/**
 * The changes a notes list takes. Each settles with what became of it; the
 * ones on an existing note name the version the caller last saw.
 */
export interface NotesActions {
  addNote: (body: string) => Promise<NoteOutcome>;
  updateNote: (
    id: string,
    body: string,
    baseVersion: number,
  ) => Promise<NoteOutcome>;
  deleteNote: (id: string, baseVersion: number) => Promise<NoteOutcome>;
  reorderNote: (
    id: string,
    afterId: string | null,
    baseVersion: number,
  ) => Promise<NoteOutcome>;
}

export function NotesView({
  snap,
  actions,
  blockedReason = null,
}: Readonly<{
  snap: NotesSnapshot;
  actions: NotesActions;
  /** Why changes are switched off, shown as the composer's tip; null when they work. */
  blockedReason?: string | null;
}>) {
  const [draft, setDraft] = useState("");
  const blocked = blockedReason !== null;
  const composerTip = useTooltip(blockedReason);
  const ordered = useMemo(
    () => [...snap.notes].sort((a, b) => a.order - b.order),
    [snap.notes],
  );
  const submit = async () => {
    const body = draft.trim();
    if (!body || blocked) return;
    // The draft goes only once the host has taken it, so a note that did not leave is still in the field.
    const outcome = await actions.addNote(body);
    if (outcome.status === "ok") setDraft("");
  };
  return (
    <Panel
      panelTitle="NOTES"
      /* The composer is PINNED by Panel rather than merely rendered last. */
      panelFooter={
        <AddRow>
          <Field {...composerTip.anchor}>
            <TagAutocomplete
              aria-label="New note body (use {{ to insert a variable)"
              placeholder="New note"
              value={draft}
              disabled={blocked}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                void submit();
              }}
            />
            {composerTip.tip}
          </Field>
          <Button
            variant="primary"
            type="button"
            onClick={() => void submit()}
            disabled={!draft.trim() || blocked}
            disabledReason={blockedReason ?? undefined}
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
                prevNote={idx > 0 ? ordered[idx - 1] : null}
                nextNote={idx < ordered.length - 1 ? ordered[idx + 1] : null}
                blocked={blocked}
                actions={actions}
              />
            ))
          )}
        </Section>
      }
    />
  );
}
