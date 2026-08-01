import { getDataSource } from "@ksp-gonogo/core";
import { Grid } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import type { FlightChapterRecord, FlightRecord } from "../types";
import type { MissionHistorySource } from "./MissionHistorySource";

interface ChaptersEditorProps {
  flight: FlightRecord;
  onChange: () => void;
}

function getSource(): MissionHistorySource | undefined {
  return getDataSource("missionHistory") as MissionHistorySource | undefined;
}

/**
 * Format an elapsed-ms duration as mm:ss (or h:mm:ss above an hour). Mirrors
 * the FlightsManager `formatDuration` style: kept local so the editor
 * doesn't reach across files.
 */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Parse `mm:ss` or `h:mm:ss` (or a bare number of seconds) into elapsed ms.
 * Returns `null` for malformed input so the caller can highlight the field.
 */
function parseElapsed(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!trimmed.includes(":")) {
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n * 1000 : null;
  }
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  let totalSec = 0;
  if (nums.length === 2) totalSec = nums[0] * 60 + nums[1];
  else if (nums.length === 3)
    totalSec = nums[0] * 3600 + nums[1] * 60 + nums[2];
  else return null;
  return totalSec * 1000;
}

export function ChaptersEditor({ flight, onChange }: ChaptersEditorProps) {
  const chapters = flight.chapters ?? [];
  const duration = Math.max(0, flight.lastSampleAt - flight.launchedAt);

  // Add-form state: kept simple (controlled inputs, validated on submit).
  const [newLabel, setNewLabel] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Per-chapter edit-mode state. `null` = no chapter being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(chapter: FlightChapterRecord) {
    setEditingId(chapter.id);
    setEditLabel(chapter.label);
    setEditStart(formatElapsed(chapter.startMs));
    setEditEnd(formatElapsed(chapter.endMs));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleAdd() {
    const src = getSource();
    if (!src) return;
    const startMs = parseElapsed(newStart);
    const endMs = parseElapsed(newEnd);
    if (newLabel.trim() === "") {
      setAddError("Label required");
      return;
    }
    if (startMs === null || endMs === null) {
      setAddError("Start and end must be mm:ss");
      return;
    }
    if (endMs <= startMs) {
      setAddError("End must be after start");
      return;
    }
    setAddError(null);
    await src.addChapter(flight.id, {
      label: newLabel.trim(),
      startMs,
      endMs,
    });
    setNewLabel("");
    setNewStart("");
    setNewEnd("");
    onChange();
  }

  async function handleSaveEdit(chapterId: string) {
    const src = getSource();
    if (!src) return;
    const startMs = parseElapsed(editStart);
    const endMs = parseElapsed(editEnd);
    if (editLabel.trim() === "") {
      setEditError("Label required");
      return;
    }
    if (startMs === null || endMs === null) {
      setEditError("Start and end must be mm:ss");
      return;
    }
    if (endMs <= startMs) {
      setEditError("End must be after start");
      return;
    }
    setEditError(null);
    await src.updateChapter(flight.id, chapterId, {
      label: editLabel.trim(),
      startMs,
      endMs,
    });
    setEditingId(null);
    onChange();
  }

  async function handleRemove(chapterId: string) {
    const src = getSource();
    if (!src) return;
    await src.removeChapter(flight.id, chapterId);
    if (editingId === chapterId) cancelEdit();
    onChange();
  }

  return (
    <Container>
      <Header>Chapters</Header>
      {chapters.length === 0 ? (
        <Hint>No chapters yet. Add markers to slice the flight.</Hint>
      ) : (
        <List>
          {chapters
            .slice()
            .sort((a, b) => a.startMs - b.startMs)
            .map((c) => {
              const isEditing = editingId === c.id;
              return (
                <ChapterRow key={c.id}>
                  {isEditing ? (
                    <>
                      <Field
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        aria-label="Chapter label"
                      />
                      <Field
                        type="text"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                        aria-label="Chapter start (mm:ss)"
                        placeholder="mm:ss"
                      />
                      <Field
                        type="text"
                        value={editEnd}
                        onChange={(e) => setEditEnd(e.target.value)}
                        aria-label="Chapter end (mm:ss)"
                        placeholder="mm:ss"
                      />
                      <Actions>
                        <SaveButton
                          type="button"
                          onClick={() => void handleSaveEdit(c.id)}
                        >
                          Save
                        </SaveButton>
                        <CancelButton type="button" onClick={cancelEdit}>
                          Cancel
                        </CancelButton>
                      </Actions>
                    </>
                  ) : (
                    <>
                      <Label title={c.label}>{c.label}</Label>
                      <TimeText>
                        {formatElapsed(c.startMs)} – {formatElapsed(c.endMs)}
                      </TimeText>
                      <DurationText>
                        ({formatElapsed(c.endMs - c.startMs)})
                      </DurationText>
                      <Actions>
                        <EditButton type="button" onClick={() => startEdit(c)}>
                          edit
                        </EditButton>
                        <RemoveButton
                          type="button"
                          onClick={() => void handleRemove(c.id)}
                          aria-label={`Remove chapter ${c.label}`}
                        >
                          ×
                        </RemoveButton>
                      </Actions>
                    </>
                  )}
                </ChapterRow>
              );
            })}
        </List>
      )}
      {editError && <ErrorText>{editError}</ErrorText>}

      <AddRow>
        <Field
          type="text"
          placeholder="Chapter name"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          aria-label="New chapter label"
        />
        <Field
          type="text"
          placeholder="0:00"
          value={newStart}
          onChange={(e) => setNewStart(e.target.value)}
          aria-label="New chapter start (mm:ss)"
        />
        <Field
          type="text"
          placeholder={formatElapsed(duration)}
          value={newEnd}
          onChange={(e) => setNewEnd(e.target.value)}
          aria-label="New chapter end (mm:ss)"
        />
        <AddButton type="button" onClick={() => void handleAdd()}>
          + add
        </AddButton>
      </AddRow>
      {addError && <ErrorText>{addError}</ErrorText>}
    </Container>
  );
}

const Container = styled.div`
  padding: var(--space-10) var(--space-12) var(--space-12);
  background: var(--color-surface-app);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const Header = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-bottom: var(--space-6);
`;

const Hint = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  margin-bottom: var(--space-8);
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: var(--space-8);
`;

// Gap moves 10px to 8px. The scale is 2/4/8/12/16, 10 sits exactly between
// two rungs, and the convention here is nearest-with-ties-to-the-smaller.
const ChapterRow = styled(Grid).attrs({
  cols: "minmax(120px, 1fr) auto auto auto",
  gap: "md" as const,
})`
  font-size: var(--font-size-sm);
`;

const Label = styled.span`
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TimeText = styled.span`
  font-family: monospace;
  color: var(--color-text-muted);
  white-space: nowrap;
`;

const DurationText = styled.span`
  font-family: monospace;
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  white-space: nowrap;
`;

const Actions = styled.span`
  display: inline-flex;
  gap: var(--space-6);
  align-items: center;
  justify-self: end;
`;

const EditButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-xs);
  &:hover { color: var(--color-text-primary); border-color: var(--color-text-dim); }
`;

const SaveButton = styled.button`
  background: var(--color-status-go-bg);
  border: 1px solid var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: var(--space-2) var(--space-8);
  border-radius: var(--radius-xs);
`;

const CancelButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-xs);
  &:hover { color: var(--color-text-primary); }
`;

const RemoveButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 0 var(--space-4);
  &:hover { color: var(--color-status-nogo-bg); }
`;

const AddRow = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 80px 80px auto;
  gap: var(--space-6);
  align-items: center;
  margin-top: var(--space-4);
`;

const Field = styled.input`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-xs);
  min-width: 0;
  /* Focus-ring geometry, deliberately off the spacing ladder even though the
     offset happens to equal --space-hair. The whole outline/outline-offset
     pair is a WCAG indicator, not rhythm, so it must not inherit a later
     retune of the spacing scale. (It is also the repo's only 1px offset
     against a 2px house rule; the fix for that is to make it 2px, not to
     tokenise it.) */
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 1px;
  }
`;

const AddButton = styled.button`
  background: none;
  border: 1px dashed var(--color-text-faint);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--font-size-xs);
  padding: var(--space-4) var(--space-10);
  border-radius: var(--radius-xs);
  white-space: nowrap;
  &:hover { color: var(--color-text-primary); border-color: var(--color-text-dim); }
`;

const ErrorText = styled.div`
  margin-top: var(--space-4);
  font-size: var(--font-size-xs);
  color: var(--color-tag-red-fg);
`;
