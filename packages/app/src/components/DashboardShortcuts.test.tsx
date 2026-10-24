import { SerialDeviceProvider, SerialDeviceService } from "@ksp-gonogo/serial";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { onSettingsRequested } from "../settings/settingsRequest";
import { ComponentOverlay, OverlayProvider } from "./ComponentOverlay";
import { DashboardShortcuts } from "./DashboardShortcuts";

function setup() {
  const history = { undo: vi.fn(), redo: vi.fn() };
  const serialService = new SerialDeviceService({ screenKey: "test" });
  render(
    <ModalProvider>
      <SerialDeviceProvider service={serialService}>
        <OverlayProvider addItems={vi.fn()} updateItemConfig={vi.fn()}>
          <DashboardShortcuts history={history} />
          <ComponentOverlay />
          <input aria-label="Name" />
        </OverlayProvider>
      </SerialDeviceProvider>
    </ModalProvider>,
  );
  return { history, user: userEvent.setup() };
}

describe("DashboardShortcuts", () => {
  it("undoes with Ctrl+Z or Cmd+Z and redoes with Shift+Z or Ctrl+Y", async () => {
    const { history, user } = setup();

    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Meta>}z{/Meta}");
    expect(history.undo).toHaveBeenCalledTimes(2);

    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await user.keyboard("{Control>}y{/Control}");
    expect(history.redo).toHaveBeenCalledTimes(2);
    expect(history.undo).toHaveBeenCalledTimes(2);
  });

  it("opens Add widget with Ctrl+K", async () => {
    const { user } = setup();

    await user.keyboard("{Control>}k{/Control}");

    expect(
      await screen.findByRole("combobox", { name: "Search widgets" }),
    ).toBeInTheDocument();
  });

  it("opens Help with Ctrl+/ or Cmd+/", async () => {
    const { user } = setup();
    const requested = vi.fn();
    const off = onSettingsRequested(requested);

    await user.keyboard("{Control>}/{/Control}");
    await user.keyboard("{Meta>}/{/Meta}");

    off();
    expect(requested).toHaveBeenCalledTimes(2);
    expect(requested).toHaveBeenCalledWith("help");
  });

  it("leaves a text field and a bare key alone", async () => {
    const { history, user } = setup();

    await user.click(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Control>}k{/Control}");
    expect(history.undo).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(document.body);
    await user.keyboard("zyk");
    expect(history.undo).not.toHaveBeenCalled();
    expect(history.redo).not.toHaveBeenCalled();
  });

  it("does nothing while the Add widget picker is open", async () => {
    const { history, user } = setup();

    await user.click(screen.getByRole("button", { name: "Add widget" }));
    await user.keyboard("{Control>}z{/Control}");

    expect(history.undo).not.toHaveBeenCalled();
  });
});
