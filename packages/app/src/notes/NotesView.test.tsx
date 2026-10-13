import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type NotesActions, NotesView } from "./NotesView";
import type { Note, NoteOutcome } from "./types";

const note = (id: string, body: string, order: number, version = 1): Note => ({
  id,
  body,
  order,
  version,
  createdAt: 0,
  updatedAt: 0,
});

const ok: NoteOutcome = { status: "ok" };

/** The words the nearest tooltip anchor above `el` carries. */
const tipOn = (el: Element) =>
  el.closest("[data-tooltip]")?.getAttribute("data-tooltip");

function renderNotes(
  notes: Note[],
  overrides: Partial<NotesActions> = {},
  blockedReason: string | null = null,
) {
  const actions: NotesActions = {
    addNote: vi.fn(async () => ok),
    updateNote: vi.fn(async () => ok),
    deleteNote: vi.fn(async () => ok),
    reorderNote: vi.fn(async () => ok),
    ...overrides,
  };
  const view = render(
    <NotesView
      snap={{ centreId: "ground:home", notes }}
      actions={actions}
      blockedReason={blockedReason}
    />,
  );
  return { actions, ...view };
}

describe("NotesView", () => {
  it("adds a trimmed note on Enter, and not on Shift+Enter", async () => {
    const { actions } = renderNotes([]);
    const composer = screen.getByLabelText(/New note body/);
    fireEvent.change(composer, { target: { value: "  check fuel  " } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(actions.addNote).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(actions.addNote).toHaveBeenCalledWith("check fuel");
    // The composer clears once the host has taken the note, a microtask after the key press.
    await act(async () => {});
    expect((composer as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the composer's text when the note did not leave", async () => {
    renderNotes([], {
      addNote: vi.fn(async () => ({ status: "offline" }) as NoteOutcome),
    });
    const composer = screen.getByLabelText(/New note body/);
    fireEvent.change(composer, { target: { value: "check fuel" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await act(async () => {});
    expect((composer as HTMLTextAreaElement).value).toBe("check fuel");
  });

  it("offers one way to remove a note, which deletes it at the version shown", async () => {
    const { actions } = renderNotes([note("a", "first", 0, 4)]);
    fireEvent.click(screen.getByLabelText("Delete note"));
    expect(actions.deleteNote).toHaveBeenCalledWith("a", 4);
    await act(async () => {});
  });

  it("edits a note from the keyboard alone, and sends the version it was shown", async () => {
    const user = userEvent.setup();
    const { actions } = renderNotes([note("a", "first", 0, 3)]);
    await user.tab();
    // The first stop is the move-up control of a one-note list, which is disabled, so the note text is the first.
    const text = screen.getByRole("button", { name: "first" });
    expect(document.activeElement).toBe(text);
    await user.keyboard("{Enter}");
    const editor = screen.getByDisplayValue("first");
    expect(document.activeElement).toBe(editor);
    await user.type(editor, "!{Enter}");
    expect(actions.updateNote).toHaveBeenCalledWith("a", "first!", 3);
  });

  it("discards an edit on Escape", async () => {
    const user = userEvent.setup();
    const { actions } = renderNotes([note("a", "first", 0)]);
    await user.click(screen.getByRole("button", { name: "first" }));
    const editor = screen.getByDisplayValue("first");
    await user.type(editor, "x{Escape}");
    expect(actions.updateNote).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "first" })).toBeTruthy();
  });

  it("moves a note up by landing its predecessor after it", () => {
    const { actions } = renderNotes([
      note("a", "first", 0, 2),
      note("b", "second", 1, 5),
    ]);
    const [, secondUp] = screen.getAllByLabelText("Move up");
    fireEvent.click(secondUp);
    expect(actions.reorderNote).toHaveBeenCalledWith("a", "b", 2);
  });

  describe("an edit refused because the note changed elsewhere", () => {
    const refusedFirst = () =>
      vi
        .fn<NotesActions["updateNote"]>()
        .mockResolvedValueOnce({
          status: "refused",
          current: note("a", "theirs", 0, 2),
        })
        .mockResolvedValue(ok);

    it("keeps what was typed, marks the field and says why in its tip", async () => {
      const user = userEvent.setup();
      const updateNote = refusedFirst();
      renderNotes([note("a", "first", 0)], { updateNote });
      await user.click(screen.getByRole("button", { name: "first" }));
      const editor = screen.getByDisplayValue("first");
      await user.type(editor, " mine{Enter}");

      await waitFor(() =>
        expect(
          screen.getByDisplayValue("first mine").getAttribute("aria-invalid"),
        ).toBe("true"),
      );
      expect(tipOn(screen.getByDisplayValue("first mine"))).toBe(
        "Changed elsewhere. Enter keeps yours, Escape takes theirs",
      );
    });

    it("sends the same text again on Enter, against the newer version", async () => {
      const user = userEvent.setup();
      const updateNote = refusedFirst();
      const { rerender, actions } = renderNotes([note("a", "first", 0)], {
        updateNote,
      });
      await user.click(screen.getByRole("button", { name: "first" }));
      await user.type(screen.getByDisplayValue("first"), " mine{Enter}");
      await waitFor(() =>
        expect(screen.getByDisplayValue("first mine")).toBeTruthy(),
      );
      // The host's snapshot of the newer note arrives while the edit is held.
      rerender(
        <NotesView
          snap={{ centreId: "ground:home", notes: [note("a", "theirs", 0, 2)] }}
          actions={actions}
        />,
      );
      expect(screen.getByDisplayValue("first mine")).toBeTruthy();
      await user.type(screen.getByDisplayValue("first mine"), "{Enter}");
      expect(updateNote).toHaveBeenLastCalledWith("a", "first mine", 2);
    });

    it("takes their text on Escape", async () => {
      const user = userEvent.setup();
      const { rerender, actions } = renderNotes([note("a", "first", 0)], {
        updateNote: refusedFirst(),
      });
      await user.click(screen.getByRole("button", { name: "first" }));
      await user.type(screen.getByDisplayValue("first"), " mine{Enter}");
      await waitFor(() =>
        expect(screen.getByDisplayValue("first mine")).toBeTruthy(),
      );
      rerender(
        <NotesView
          snap={{ centreId: "ground:home", notes: [note("a", "theirs", 0, 2)] }}
          actions={actions}
        />,
      );
      await user.type(screen.getByDisplayValue("first mine"), "{Escape}");
      expect(screen.getByRole("button", { name: "theirs" })).toBeTruthy();
    });

    it("offers to add the text again when the note was deleted elsewhere", async () => {
      const user = userEvent.setup();
      const { actions } = renderNotes([note("a", "first", 0)], {
        updateNote: vi.fn(
          async () => ({ status: "refused", current: null }) as NoteOutcome,
        ),
      });
      await user.click(screen.getByRole("button", { name: "first" }));
      await user.type(screen.getByDisplayValue("first"), " mine{Enter}");
      await waitFor(() =>
        expect(tipOn(screen.getByDisplayValue("first mine"))).toBe(
          "Deleted elsewhere. Enter adds it again, Escape drops it",
        ),
      );
      await user.type(screen.getByDisplayValue("first mine"), "{Enter}");
      expect(actions.addNote).toHaveBeenCalledWith("first mine");
    });
  });

  describe("with changes switched off", () => {
    it("disables every control and says why on the composer's tip", () => {
      renderNotes(
        [note("a", "first", 0), note("b", "second", 1)],
        {},
        "Not connected to the main screen",
      );
      const composer = screen.getByLabelText(/New note body/);
      expect(composer.hasAttribute("readonly")).toBe(true);
      expect(tipOn(composer)).toBe("Not connected to the main screen");
      for (const control of screen.getAllByLabelText("Delete note")) {
        expect((control as HTMLButtonElement).disabled).toBe(true);
      }
      expect(
        (screen.getByRole("button", { name: "first" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      const add = screen.getByRole("button", { name: "Add" });
      expect(add.getAttribute("aria-disabled")).toBe("true");
    });
  });

  it("has no accessibility violations", async () => {
    const { container } = renderNotes([
      note("a", "first", 0),
      note("b", "second", 1),
    ]);
    await expectNoA11yViolations(container);
  });
});
