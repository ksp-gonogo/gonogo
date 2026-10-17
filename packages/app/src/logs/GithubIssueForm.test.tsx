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
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    logger.info("map went blank");
    const user = await openForm();
    await user.type(screen.getByLabelText(/what went wrong/i), "Map is blank");
    await user.click(
      screen.getByRole("button", { name: /open github issue/i }),
    );
    const url = new URL(String(open.mock.calls[0]?.[0]));
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("what-happened")).toBe("Map is blank");
    expect(url.searchParams.get("screen")).toBe("Main screen");
    expect(url.searchParams.get("logs")).toContain("map went blank");
  });

  it("leaves the log out when the switch is off", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    logger.info("map went blank");
    const user = await openForm();
    await user.click(screen.getByLabelText(/include the app log/i));
    await user.click(
      screen.getByRole("button", { name: /open github issue/i }),
    );
    const url = new URL(String(open.mock.calls[0]?.[0]));
    expect(url.searchParams.has("logs")).toBe(false);
  });

  it("includes KSP.log by default and still opens when the mod does not answer", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const user = await openForm();
    expect(screen.getByLabelText(/include ksp\.log/i)).toBeChecked();
    await user.click(
      screen.getByRole("button", { name: /open github issue/i }),
    );
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  });
});
