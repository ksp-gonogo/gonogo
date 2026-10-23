import { logger } from "@ksp-gonogo/logger";
import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrashScreen } from "./CrashScreen";
import { VERSION } from "./version";

function crash(message: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at Widget (widget.tsx:1:1)`;
  return error;
}

describe("CrashScreen", () => {
  afterEach(() => {
    logger.setEnabled(false);
    logger.clearBuffer();
  });

  it("says what crashed and offers a reload", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const { container } = render(
      <CrashScreen error={crash("boom in the map")} onReload={onReload} />,
    );

    expect(screen.getByText("Something went wrong.")).not.toBeNull();
    expect(screen.getByText("boom in the map")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    await expectNoA11yViolations(container);
  });

  it("copies a report with the error, its stack, the version and the recent log", async () => {
    const user = userEvent.setup();
    logger.setEnabled(true);
    logger.info("station was mid-handshake");
    render(<CrashScreen error={crash("boom in the map")} onReload={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    const report = await navigator.clipboard.readText();
    expect(report).toContain("boom in the map");
    expect(report).toContain("at Widget (widget.tsx:1:1)");
    expect(report).toContain(`App version: ${VERSION}`);
    expect(report).toContain("station was mid-handshake");
    expect(screen.getByText("Report copied.")).not.toBeNull();
  });

  it("shows the report to select by hand when the clipboard refuses", async () => {
    const user = userEvent.setup();
    render(<CrashScreen error={crash("boom")} onReload={vi.fn()} />);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    expect(
      (screen.getByLabelText("Report") as HTMLTextAreaElement).value,
    ).toContain("boom");
  });
});
