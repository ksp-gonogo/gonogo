import { render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HelpButton } from "./HelpButton";
import { onSettingsRequested } from "./settingsRequest";

describe("HelpButton", () => {
  it("asks for Settings on its Help tab", async () => {
    const requested = vi.fn();
    const off = onSettingsRequested(requested);
    render(<HelpButton />);

    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: "Help and keyboard shortcuts" }),
      );

    off();
    expect(requested).toHaveBeenCalledWith("help");
  });
});
