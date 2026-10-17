import { logger } from "@ksp-gonogo/logger";
import { render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogsManager } from "./LogsManager";

beforeEach(() => {
  logger.clearBuffer();
  logger.setEnabled(true);
});

afterEach(() => {
  logger.clearBuffer();
  vi.restoreAllMocks();
});

/** A stand-in for the window the click opens, which the form points at the issue once the log is ready. */
function fakePopup() {
  const popup: Partial<Window> = {
    location: { href: "" } as Location,
    close: vi.fn(),
  };
  return popup as Window;
}

async function openForm() {
  const user = userEvent.setup();
  render(
    <ModalProvider>
      <LogsManager />
    </ModalProvider>,
  );
  await user.click(
    screen.getByRole("button", { name: /open a github issue/i }),
  );
  return user;
}

describe("Open a GitHub issue", () => {
  it("opens the bug report form with the description and the log", async () => {
    const popup = fakePopup();
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    logger.info("map went blank");
    const user = await openForm();
    await user.type(screen.getByLabelText(/what went wrong/i), "Map is blank");
    await user.click(
      screen.getByRole("button", { name: /open github issue/i }),
    );
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    expect(open).toHaveBeenCalledTimes(1);
    const body = new URL(popup.location.href).searchParams.get("body") ?? "";
    expect(body).toContain("Map is blank");
    expect(body).toContain("Screen: Main screen");
    expect(body).toContain("map went blank");
  });

  it("leaves the log out when the switch is off", async () => {
    const popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup);
    logger.info("map went blank");
    const user = await openForm();
    await user.click(screen.getByLabelText(/include the app log/i));
    await user.click(
      screen.getByRole("button", { name: /open github issue/i }),
    );
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    const body = new URL(popup.location.href).searchParams.get("body") ?? "";
    expect(body).not.toContain("map went blank");
    expect(body).not.toContain("## Logs");
  });

  it("includes KSP.log by default and still opens when the mod does not answer", async () => {
    const popup = fakePopup();
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    const user = await openForm();
    expect(screen.getByLabelText(/include ksp\.log/i)).toBeChecked();
    await user.click(
      screen.getByRole("button", { name: /open github issue/i }),
    );
    await vi.waitFor(() => expect(popup.location.href).not.toBe(""));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shows a plain link when the browser blocks the window", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const user = await openForm();
    await user.click(
      screen.getByRole("button", { name: /open github issue/i }),
    );
    const link = await screen.findByRole("link", {
      name: /open the github issue/i,
    });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/ksp-gonogo/gonogo/issues/new"),
    );
  });
});
