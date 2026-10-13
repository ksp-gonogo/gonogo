import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DataKeyPicker, type KeyOption } from "./DataKeyPicker";
import { ModalProvider, useModal } from "./Modal";
import { Tooltip } from "./Tooltip";

const KEYS: KeyOption[] = [
  { key: "v.altitude", label: "Altitude", unit: "m", group: "Position" },
];

function Opener({ content }: { content: React.ReactNode }) {
  const { open } = useModal();
  return (
    <button type="button" onClick={() => open(content, { title: "Dialog" })}>
      open
    </button>
  );
}

describe("Escape used by a control inside a dialog", () => {
  it("closes an open picker list without closing the dialog", async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <Opener
          content={
            <DataKeyPicker
              keys={KEYS}
              value={null}
              onChange={() => undefined}
            />
          }
        />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByText("Position")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Position")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("dismisses a tooltip without closing the dialog", async () => {
    const user = userEvent.setup();
    render(
      <ModalProvider>
        <Opener
          content={
            <Tooltip text="Explains the field">
              <input aria-label="field" />
            </Tooltip>
          }
        />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    await user.hover(screen.getByLabelText("field"));
    expect(document.querySelector("[data-tooltip-tip]")).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(document.querySelector("[data-tooltip-tip]")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
