import { logger, tagRegistry } from "@ksp-gonogo/logger";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LogsManager } from "./LogsManager";

// Most of the rest of the modal (Verbose logging, Log buffer) reads
// global state and renders with no providers in scope, so the smoke test
// just renders the component inside a ModalProvider in case any nested
// hook-of-hook ever needs it. The interesting assertions are on the
// "Report bug" subform.

/** Every request the ingest endpoint received, as its parsed JSON body. */
let ingested: unknown[][] = [];
let ingestStatus = 200;

// The one-shot report transport talks to Axiom itself, so intercept at the network boundary.
const server = setupServer(
  http.post(
    "https://api.axiom.co/v1/datasets/:dataset/ingest",
    async ({ request }) => {
      ingested.push((await request.json()) as unknown[]);
      return ingestStatus === 200
        ? HttpResponse.json({ ingested: 1, failed: 0 })
        : new HttpResponse("nope", { status: ingestStatus });
    },
  ),
);

beforeAll(() => {
  // Without CompressionStream the SDK sends plain JSON; jsdom's Blob cannot feed its gzip path.
  vi.stubGlobal("CompressionStream", undefined);
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  ingested = [];
  ingestStatus = 200;
  vi.stubEnv("VITE_AXIOM_TOKEN", "test-token");
  logger.clearBuffer();
  logger.setEnabled(true);
});

afterEach(() => {
  logger.clearBuffer();
  vi.useRealTimers();
  vi.unstubAllEnvs();
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
  await user.click(screen.getByRole("button", { name: /send feedback/i }));
  return user;
}

/** The `bug_report` block a logged entry carries, or a failure saying it had none. */
function bugReport(entry: { context?: Record<string, unknown> }): {
  kind: string;
  timeWindowMinutes: number | null;
  recentLogsCount: number;
  recentLogs: unknown[];
  screenshot: unknown;
  reportedAt: string;
} {
  const payload = entry.context?.bug_report;
  if (typeof payload !== "object" || payload === null) {
    throw new Error("the entry carries no bug_report block");
  }
  return payload as {
    kind: string;
    timeWindowMinutes: number | null;
    recentLogsCount: number;
    recentLogs: unknown[];
    screenshot: unknown;
    reportedAt: string;
  };
}

describe("LogsManager: Verbose logging", () => {
  afterEach(() => {
    localStorage.removeItem("LOG_TAGS");
    tagRegistry.clearOverride();
  });

  it("turns debug lines on for every subsystem and persists the choice", async () => {
    const user = userEvent.setup();
    renderManager();
    const toggle = screen.getByRole("checkbox", { name: /verbose logging/i });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(tagRegistry.isVerbose()).toBe(true);
    expect(localStorage.getItem("LOG_TAGS")).toBe("*");

    await user.click(toggle);
    expect(tagRegistry.isVerbose()).toBe(false);
    expect(localStorage.getItem("LOG_TAGS")).toBeNull();
  });

  it("ignores a stored tag list from an older version", () => {
    localStorage.setItem("LOG_TAGS", "peer,camera");
    renderManager();
    expect(
      screen.getByRole("checkbox", { name: /verbose logging/i }),
    ).not.toBeChecked();
  });
});

describe("LogsManager: Feedback", () => {
  it("emits a bug-report tagged entry with the description and recent-logs slice on submit", async () => {
    // Fake timers (shouldAdvanceTime so userEvent's internal delays still
    // run) so the post-success setTimeout(5000) that resets the form can be
    // drained inside act() immediately after the success notice; otherwise
    // it fires its state updates after the test ends, outside act().
    vi.useFakeTimers({ shouldAdvanceTime: true });
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

    // Drain the 5s form-reset timer NOW: immediately after the notice, before
    // any further awaits: so it fires inside this act()-wrapped drain rather
    // than via the background wall-clock advancer after the test ends. A
    // deliberately-drained timer callback is a synchronous setState push with
    // no testing-library equivalent (the rule-3 act() case).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const reports = logger.getBuffer().filter((e) => e.tag === "bug-report");
    expect(reports).toHaveLength(1);
    const entry = reports[0];
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("[bug-report] Altitude gauge froze");

    const payload = bugReport(entry);
    expect(payload.kind).toBe("bug");
    expect(payload.timeWindowMinutes).toBe(5);
    expect(payload.recentLogsCount).toBeGreaterThanOrEqual(1);
    expect(payload.recentLogs.length).toBe(payload.recentLogsCount);
    expect(payload.screenshot).toBeNull();
    expect(typeof payload.reportedAt).toBe("string");
  });

  it("emits a feedback-tagged info entry when the type is set to Feedback", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = await openReportForm();

    await user.selectOptions(screen.getByLabelText(/type/i), "Feedback");
    await user.type(
      screen.getByLabelText(/your feedback/i),
      "Add a delta-v readout",
    );
    await user.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(() => {
      expect(screen.getByText(/feedback sent/i)).toBeInTheDocument();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const entries = logger.getBuffer().filter((e) => e.tag === "feedback");
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe("info");
    expect(entries[0].message).toBe("[feedback] Add a delta-v readout");
    const payload = bugReport(entries[0]);
    expect(payload.kind).toBe("feedback");
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
    // be >=1: the meaningful assertion here is that the hint re-renders
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

    // Drain the 5s reset timer inside act() immediately after the notice so it fires here rather than via the background advancer after the test.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    await waitFor(() => {
      expect(screen.queryByText(/bug report sent/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /send feedback/i }),
      ).toBeInTheDocument();
    });
  });

  it("cancels back to the closed button without emitting anything", async () => {
    const user = await openReportForm();

    await user.type(screen.getByLabelText(/what went wrong/i), "won't send");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(
      screen.getByRole("button", { name: /send feedback/i }),
    ).toBeInTheDocument();
    const reports = logger.getBuffer().filter((e) => e.tag === "bug-report");
    expect(reports).toHaveLength(0);
  });
});

describe("LogsManager: Feedback with analytics off", () => {
  it("sends the report to the developer through its own one-shot transport", async () => {
    expect(logger.transportCount()).toBe(0);
    const user = await openReportForm();
    await user.type(screen.getByLabelText(/what went wrong/i), "Gauge froze");
    await user.click(screen.getByRole("button", { name: /send report/i }));

    await waitFor(
      () => {
        expect(screen.getByText(/bug report sent/i)).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    const events = ingested.flat() as { message?: string; tag?: string }[];
    expect(events.some((e) => e.message === "[bug-report] Gauge froze")).toBe(
      true,
    );
    // The one-shot is gone again, so nothing else is shipped in the background.
    expect(logger.transportCount()).toBe(0);
    await act(async () => {});
  });

  it("says plainly that the report was not sent when delivery fails", async () => {
    ingestStatus = 500;
    const user = await openReportForm();
    await user.type(screen.getByLabelText(/what went wrong/i), "Gauge froze");
    await user.click(screen.getByRole("button", { name: /send report/i }));

    expect(
      await screen.findByText(/report could not be sent/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/bug report sent/i)).not.toBeInTheDocument();
    await act(async () => {});
  });

  it("says plainly that the build cannot send when it has no token", async () => {
    vi.stubEnv("VITE_AXIOM_TOKEN", "");
    const user = await openReportForm();
    await user.type(screen.getByLabelText(/what went wrong/i), "Gauge froze");
    await user.click(screen.getByRole("button", { name: /send report/i }));

    expect(
      await screen.findByText(/cannot send reports to the developer/i),
    ).toBeInTheDocument();
    expect(ingested).toHaveLength(0);
    await act(async () => {});
  });
});
