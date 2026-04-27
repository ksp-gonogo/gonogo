import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModalProvider, useModal } from "./Modal";

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
});
