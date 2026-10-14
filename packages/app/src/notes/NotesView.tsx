import { Button, Panel, Section, useTooltip } from "@ksp-gonogo/ui-kit";
import { useCallback, useMemo, useState } from "react";
import { NoteRow } from "./NoteRow";
import { AddRow, Empty, Field } from "./notesStyles";
import { TagAutocomplete } from "./TagAutocomplete";
import type { Note, NoteOutcome, NotesSnapshot } from "./types";

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
  const [unsaved, setUnsaved] = useState<{
    centreId: string | null;
    notes: ReadonlyMap<string, Note>;
  }>({ centreId: snap.centreId, notes: new Map() });
  const centreId = snap.centreId;
  const reportUnsaved = useCallback(
    (id: string, note: Note | null) =>
      setUnsaved((prev) => {
        const same = prev.centreId === centreId;
        if (
          same &&
          (note === null ? !prev.notes.has(id) : prev.notes.get(id) === note)
        ) {
          return prev;
        }
        const notes = new Map(same ? prev.notes : []);
        if (note === null) notes.delete(id);
        else notes.set(id, note);
        return { centreId, notes };
      }),
    [centreId],
  );
  /*
   * A note deleted elsewhere while its editor holds changed text stays listed
   * until the operator adds it again or drops the edit. A kept note belongs to
   * the centre it was edited at and goes when the list changes centre.
   */
  const rows = useMemo(() => {
    const live = new Set(snap.notes.map((n) => n.id));
    const kept =
      unsaved.centreId === snap.centreId
        ? [...unsaved.notes.values()].filter((n) => !live.has(n.id))
        : [];
    return [
      ...snap.notes.map((note) => ({ note, gone: false })),
      ...kept.map((note) => ({ note, gone: true })),
    ].sort((a, b) => a.note.order - b.note.order);
  }, [snap.notes, snap.centreId, unsaved]);
  const ordered = useMemo(
    () => rows.filter((r) => !r.gone).map((r) => r.note),
    [rows],
  );
  const submit = async () => {
    const body = draft.trim();
    if (!body || blocked) return;
    // The draft goes only once the host has taken it, so a note that did not leave is still in the field.
    const outcome = await actions.addNote(body);
    if (outcome.status === "ok") {
      setDraft((current) => (current.trim() === body ? "" : current));
    }
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
          {rows.length === 0 ? (
            <Empty>No notes yet. Type {"{{"} for live data</Empty>
          ) : (
            rows.map(({ note, gone }) => {
              const idx = ordered.indexOf(note);
              return (
                <NoteRow
                  key={note.id}
                  note={note}
                  isFirst={idx <= 0}
                  isLast={idx === ordered.length - 1}
                  prevNote={idx > 0 ? ordered[idx - 1] : null}
                  nextNote={
                    idx >= 0 && idx < ordered.length - 1
                      ? ordered[idx + 1]
                      : null
                  }
                  blocked={blocked}
                  actions={actions}
                  gone={gone}
                  onUnsaved={reportUnsaved}
                />
              );
            })
          )}
        </Section>
      }
    />
  );
}
