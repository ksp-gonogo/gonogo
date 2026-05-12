import { logger } from "@gonogo/logger";
import { ModalProvider } from "@gonogo/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogsManager } from "./LogsManager";

// Most of the rest of the modal (Snapshot, Active tags, Log buffer) reads
// global state and renders with no providers in scope, so the smoke test
// just renders the component inside a ModalProvider in case any nested
// hook-of-hook ever needs it. The interesting assertions are on the
// "Report bug" subform.

beforeEach(() => {
  logger.clearBuffer();
  logger.setEnabled(true);
});

afterEach(() => {
  logger.clearBuffer();
  vi.useRealTimers();
});

function renderManager() {
  return render(
    <ModalProvider>
      <LogsManager />
    </ModalProvider>,
  );
}

async function openReportForm() {
  const user = userEvent.setup();
  renderManager();
  await user.click(screen.getByRole("button", { name: /report a bug/i }));
  return user;
}

describe("LogsManager — Report bug", () => {
  it("emits a bug-report tagged entry with the description and recent-logs slice on submit", async () => {
    logger.info("seed-message-for-recent-window");
    const user = await openReportForm();

    await user.type(
      screen.getByLabelText(/what went wrong/i),
      "Altitude gauge froze",
    );
    await user.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => {
      expect(screen.getByText(/bug report sent/i)).toBeInTheDocument();
    });

    const reports = logger.getBuffer().filter((e) => e.tag === "bug-report");
    expect(reports).toHaveLength(1);
    const entry = reports[0];
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("[bug-report] Altitude gauge froze");

    const payload = entry.context?.bug_report as {
      timeWindowMinutes: number | null;
      recentLogsCount: number;
      recentLogs: unknown[];
      screenshot: unknown;
      reportedAt: string;
    };
    expect(payload.timeWindowMinutes).toBe(5);
    expect(payload.recentLogsCount).toBeGreaterThanOrEqual(1);
    expect(payload.recentLogs.length).toBe(payload.recentLogsCount);
    expect(payload.screenshot).toBeNull();
    expect(typeof payload.reportedAt).toBe("string");
  });

  it("disables the submit button until a description is entered", async () => {
    const user = await openReportForm();

    const submit = screen.getByRole("button", { name: /send report/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/what went wrong/i), "x");
    expect(submit).not.toBeDisabled();
  });

  it("updates the attached-entries hint when the time window changes", async () => {
    logger.info("seeded");
    const user = await openReportForm();

    expect(
      screen.getByText(/log entr(y|ies) will be attached/i),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(/include logs from/i),
      "everything in buffer",
    );

    // The seeded entry is well within all windows, so the count should still
    // be >=1 — the meaningful assertion here is that the hint re-renders
    // after a select change without crashing.
    expect(
      screen.getByText(/log entr(y|ies) will be attached/i),
    ).toBeInTheDocument();
  });

  it("collapses the form back to the closed button after the success notice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = await openReportForm();

    await user.type(screen.getByLabelText(/what went wrong/i), "broken");
    await user.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => {
      expect(screen.getByText(/bug report sent/i)).toBeInTheDocument();
    });

    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() => {
      expect(screen.queryByText(/bug report sent/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /report a bug/i }),
      ).toBeInTheDocument();
    });
  });

  it("cancels back to the closed button without emitting anything", async () => {
    const user = await openReportForm();

    await user.type(screen.getByLabelText(/what went wrong/i), "won't send");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(
      screen.getByRole("button", { name: /report a bug/i }),
    ).toBeInTheDocument();
    const reports = logger.getBuffer().filter((e) => e.tag === "bug-report");
    expect(reports).toHaveLength(0);
  });
});
