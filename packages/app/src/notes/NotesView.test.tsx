import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { type NotesActions, NotesView } from "./NotesView";
import type { Note } from "./types";

const note = (id: string, body: string, order: number): Note => ({
  id,
  body,
  order,
  createdAt: 0,
  updatedAt: 0,
});

function renderNotes(notes: Note[]) {
  const actions: NotesActions = {
    addNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    reorderNote: vi.fn(),
  };
  render(<NotesView snap={{ notes }} actions={actions} />);
  return actions;
}

describe("NotesView", () => {
  it("adds a trimmed note on Enter, and not on Shift+Enter", () => {
    const actions = renderNotes([]);
    const composer = screen.getByLabelText(/New note body/);
    fireEvent.change(composer, { target: { value: "  check fuel  " } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(actions.addNote).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(actions.addNote).toHaveBeenCalledWith("check fuel");
  });

  it("commits an edited body on Enter", () => {
    const actions = renderNotes([note("a", "first", 0)]);
    fireEvent.click(screen.getByText("first"));
    const editor = screen.getByDisplayValue("first");
    fireEvent.change(editor, { target: { value: "edited" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(actions.updateNote).toHaveBeenCalledWith("a", "edited");
    expect(screen.queryByDisplayValue("edited")).toBeNull();
  });

  it("discards an edit on Escape", () => {
    const actions = renderNotes([note("a", "first", 0)]);
    fireEvent.click(screen.getByText("first"));
    const editor = screen.getByDisplayValue("first");
    fireEvent.change(editor, { target: { value: "edited" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(actions.updateNote).not.toHaveBeenCalled();
    expect(screen.getByText("first")).toBeTruthy();
  });

  it("moves a note up by landing its predecessor after it", () => {
    const actions = renderNotes([
      note("a", "first", 0),
      note("b", "second", 1),
    ]);
    const [, secondUp] = screen.getAllByLabelText("Move up");
    fireEvent.click(secondUp);
    expect(actions.reorderNote).toHaveBeenCalledWith("a", "b");
  });
});
