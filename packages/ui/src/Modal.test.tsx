import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModalProvider, useModal, useModalSaveBar } from "./Modal";

function Opener({ onOpen }: { onOpen: (id: string) => void }) {
  const { open } = useModal();
  return (
    <button
      type="button"
      onClick={() => {
        const id = open(<p>body</p>, { title: "Demo" });
        onOpen(id);
      }}
    >
      open
    </button>
  );
}

const SAVED_VALUE = { label: "saved" };

// Config-like content that registers a sticky Save bar, so the tests exercise
// the same path real config components use. The draft opens equal to the saved
// value (clean baseline); "make dirty" diverges it, "mark clean" restores it —
// driving the hook's value-vs-baseline-vs-saved comparison rather than a
// hardcoded flag, exactly as a real config form does.
function SaveBarContent({ onSave }: { onSave: () => void }) {
  const [draft, setDraft] = useState(SAVED_VALUE);
  useModalSaveBar({ onSave, value: draft, saved: SAVED_VALUE });
  return (
    <div>
      <p>config body</p>
      <button type="button" onClick={() => setDraft({ label: "edited" })}>
        make dirty
      </button>
      <button type="button" onClick={() => setDraft(SAVED_VALUE)}>
        mark clean
      </button>
    </div>
  );
}

function SaveBarOpener({ onSave }: { onSave: () => void }) {
  const { open } = useModal();
  return (
    <button
      type="button"
      onClick={() => open(<SaveBarContent onSave={onSave} />, { title: "Cfg" })}
    >
      open
    </button>
  );
}

// Mirrors the real config-component shape that exposed the false-positive bug:
// the persisted config is SPARSE ({}), but the form materializes it into a
// DENSE object (defaults filled in). A naive `!configEqual(dense, sparse)`
// would read as dirty on a clean open; the hook's baseline capture must keep it
// clean. The "edit" button is the only thing that should make it dirty.
function SparseDefaultContent({ onSave }: { onSave: () => void }) {
  // Persisted config is empty — every field comes from a default.
  const saved: Record<string, unknown> = {};
  const [mode, setMode] = useState("auto");
  const value = { mode, enabled: true };
  useModalSaveBar({ onSave, value, saved });
  return (
    <div>
      <p>sparse body</p>
      <button type="button" onClick={() => setMode("manual")}>
        edit
      </button>
    </div>
  );
}

function SparseDefaultOpener({ onSave }: { onSave: () => void }) {
  const { open } = useModal();
  return (
    <button
      type="button"
      onClick={() =>
        open(<SparseDefaultContent onSave={onSave} />, { title: "Sparse" })
      }
    >
      open
    </button>
  );
}

describe("Modal", () => {
  it("closes on Escape — the only keyboard-accessible close path", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ModalProvider>
        <Opener onOpen={onOpen} />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ModalProvider>
        <Opener onOpen={onOpen} />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement;
    expect(backdrop).toBeTruthy();
    if (backdrop) await user.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does NOT close when mousedown starts inside the dialog and releases on the backdrop", async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <Opener onOpen={vi.fn()} />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement as HTMLElement;
    // press inside the dialog, release over the backdrop (text-selection drag)
    await user.pointer([
      { keys: "[MouseLeft>]", target: dialog },
      { target: backdrop },
      { keys: "[/MouseLeft]", target: backdrop },
    ]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does NOT close when mousedown on the backdrop releases inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <Opener onOpen={vi.fn()} />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement as HTMLElement;
    await user.pointer([
      { keys: "[MouseLeft>]", target: backdrop },
      { target: dialog },
      { keys: "[/MouseLeft]", target: dialog },
    ]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  describe("sticky save bar", () => {
    it("renders a Save button registered via useModalSaveBar", async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={onSave} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      const save = screen.getByRole("button", { name: "Save" });
      expect(save).toBeInTheDocument();
      // Save button lives outside the scrollable body (the element with the
      // config text), so it cannot scroll out of view.
      const body = screen.getByText("config body");
      expect(body.contains(save)).toBe(false);
      await user.click(save);
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("discard-changes guard", () => {
    it("blocks Escape when dirty, then closes after confirming Discard", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.click(screen.getByRole("button", { name: "make dirty" }));
      await user.keyboard("{Escape}");
      // Still open — confirmation shown instead.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("blocks the X button when dirty, then closes after confirming Discard", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.click(screen.getByRole("button", { name: "make dirty" }));
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("blocks the backdrop when dirty, then closes after confirming Discard", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.click(screen.getByRole("button", { name: "make dirty" }));
      const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
      await user.click(backdrop);
      expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("Keep editing dismisses the confirmation and stays open", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.click(screen.getByRole("button", { name: "make dirty" }));
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(
        screen.queryByText("Discard unsaved changes?"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // The form's Save bar is back.
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("Escape while confirming cancels the confirmation rather than closing", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.click(screen.getByRole("button", { name: "make dirty" }));
      await user.keyboard("{Escape}"); // opens confirmation
      expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
      await user.keyboard("{Escape}"); // cancels confirmation
      expect(
        screen.queryByText("Discard unsaved changes?"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("closes normally on Escape when never edited (clean open)", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      // Open and immediately Escape — the draft equals the saved value, so the
      // modal closes without any discard prompt.
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does NOT prompt on a clean open when the form materializes a sparse stored config", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SparseDefaultOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      // The draft is denser than the stored {} config, but nothing was edited —
      // Escape must close silently, no discard prompt.
      await user.keyboard("{Escape}");
      expect(
        screen.queryByText("Discard unsaved changes?"),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("DOES prompt after a real edit to a sparse-default form", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SparseDefaultOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.click(screen.getByRole("button", { name: "edit" }));
      await user.keyboard("{Escape}");
      expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    });

    it("closes normally after editing then reverting to the saved value", async () => {
      const user = userEvent.setup();
      render(
        <ModalProvider>
          <SaveBarOpener onSave={vi.fn()} />
        </ModalProvider>,
      );
      await user.click(screen.getByRole("button", { name: "open" }));
      await user.click(screen.getByRole("button", { name: "make dirty" }));
      await user.click(screen.getByRole("button", { name: "mark clean" }));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
