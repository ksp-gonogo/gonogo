import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { BackupManager } from "./BackupManager";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("BackupManager", () => {
  it("renders export and restore controls", () => {
    render(<BackupManager />);
    expect(
      screen.getByRole("button", { name: /export backup/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /include device identity/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/backup file/i)).toBeInTheDocument();
  });

  it("identity checkbox defaults to off", () => {
    render(<BackupManager />);
    expect(
      screen.getByRole("checkbox", { name: /include device identity/i }),
    ).not.toBeChecked();
  });

  it("shows a confirm step after a file is chosen", () => {
    render(<BackupManager />);
    const file = new File(
      [JSON.stringify({ metadata: { version: 1 }, data: {} })],
      "backup.json",
      { type: "application/json" },
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      screen.getByRole("button", { name: /replace & reload/i }),
    ).toBeInTheDocument();
    // The filename appears in both the FileInput readout and the confirm text.
    expect(screen.getAllByText(/backup\.json/i).length).toBeGreaterThan(0);
  });

  it("has no axe violations", async () => {
    const { container } = render(<BackupManager />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
