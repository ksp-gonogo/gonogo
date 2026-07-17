import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type ContractBadgeContext,
  ContractManagerComponent,
  formatDeadline,
  parseContracts,
} from "./index";

/**
 * ContractManager runs off the stream: active/offered/completedRecent all ride
 * the `career.status` Topic's `contracts` sub-tree (canonical `useTelemetry`),
 * and the view UT comes from `useViewUt()` (pinned by the fixture). No legacy
 * `MockDataSource` feeds the reads. The accept/cancel/decline commands still
 * dispatch through the legacy `execute()` path (map-command.ts), so a
 * `setupMockDataSource` AUX registered under `"data"` captures those calls.
 */

interface Contract {
  id: number | string;
  title: string;
  [key: string]: unknown;
}

const renderedTrees: Array<() => void> = [];
let legacyAux: MockDataSourceFixture | undefined;

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["career.status", "vessel.state"],
    pinnedUt: 0,
  });
}

async function captureCommands(onExecute: (action: string) => void) {
  legacyAux = await setupMockDataSource({
    id: "data",
    keys: [],
    onExecute,
    connectSource: true,
  });
}

function renderContract(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <ContractManagerComponent config={{}} id="md" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

function emitContracts(
  fixture: ReturnType<typeof newFixture>,
  contracts: {
    active?: Contract[];
    offered?: Contract[];
    completedRecent?: Contract[];
  },
) {
  fixture.emit("career.status", { contracts });
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  if (legacyAux) {
    teardownMockDataSource(legacyAux);
    legacyAux = undefined;
  }
  // The augment registry is intentionally not cleared by the data-source
  // teardown; reset it so a test-bound augment can't leak into later tests.
  clearAugments();
});

describe("ContractManagerComponent", () => {
  it("shows the awaiting placeholder before any telemetry", () => {
    renderContract(newFixture());
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
  });

  it("shows empty-state copy when there are no active contracts", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, { active: [] });
    });
    await waitFor(() =>
      expect(screen.getByText(/No active contracts/i)).toBeInTheDocument(),
    );
  });

  it("renders an active contract with parameters and rewards", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [
          {
            id: 42,
            title: "Plant a flag on the Mun",
            agency: "Kerbin Space Program",
            state: "Active",
            fundsAdvance: 5000,
            fundsCompletion: 25000,
            scienceCompletion: 15,
            repCompletion: 5,
            deadlineUt: 6 * 3600 * 5, // 5 stock days
            parameters: [
              { title: "Land on the Mun", state: "Complete", optional: false },
              { title: "Plant flag", state: "Incomplete", optional: false },
              {
                title: "Return safely",
                state: "Incomplete",
                optional: true,
              },
            ],
          },
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/Plant a flag on the Mun/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Kerbin Space Program/)).toBeInTheDocument();
    expect(screen.getByText(/25\.0k/)).toBeInTheDocument(); // fundsCompletion
    expect(screen.getByText(/Land on the Mun/)).toBeInTheDocument();
    expect(screen.getByText(/Plant flag/)).toBeInTheDocument();
    expect(screen.getByText(/Return safely/)).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
    expect(screen.getByText(/5d 0h left/i)).toBeInTheDocument();
  });

  it("renders the per-contract badges slot with no bound augment (empty is fine)", async () => {
    // No augment registered → the slot composes nothing and the cards render
    // exactly as before, one per contract.
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 42, title: "Plant a flag on the Mun", parameters: [] }],
        offered: [{ id: 7, title: "Survey the Mun", parameters: [] }],
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/Plant a flag on the Mun/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Survey the Mun/i)).toBeInTheDocument();
    expect(screen.queryByTestId("contract-badge")).not.toBeInTheDocument();
  });

  it("renders a bound augment once per contract row, carrying each contract's identity", async () => {
    // A test Uplink binds `contract-manager.badges` and echoes the slot props
    // back. Proves (a) the slot is exposed, (b) an augment composes into it,
    // and (c) the per-row props carry the right contract identity + section.
    // `requires` is omitted so no Domain presence gate applies.
    registerAugment<"contract-manager.badges">({
      id: "test-contract-badge",
      augments: "contract-manager.badges",
      component: ({ contractId, section }: ContractBadgeContext) => (
        <span
          data-testid="contract-badge"
          data-contract-id={contractId}
          data-section={section}
        >
          ★
        </span>
      ),
    });

    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 42, title: "Plant a flag on the Mun", parameters: [] }],
        offered: [{ id: 7, title: "Survey the Mun", parameters: [] }],
      });
    });

    // One badge per contract row: one active (42), one offered (7).
    const badges = await screen.findAllByTestId("contract-badge");
    expect(badges).toHaveLength(2);

    const activeBadge = badges.find(
      (b) => b.getAttribute("data-contract-id") === "42",
    );
    const offeredBadge = badges.find(
      (b) => b.getAttribute("data-contract-id") === "7",
    );
    expect(activeBadge?.getAttribute("data-section")).toBe("active");
    expect(offeredBadge?.getAttribute("data-section")).toBe("offered");

    // Each badge sits inside its own contract's card (props identity correct).
    const activeCard = screen
      .getByText("Plant a flag on the Mun")
      .closest("div");
    expect(activeCard).not.toBeNull();
    expect(
      within(activeCard as HTMLElement).getByTestId("contract-badge"),
    ).toHaveAttribute("data-contract-id", "42");
  });

  it("fires contracts.accept when the Accept button on an offered contract is clicked", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    await captureCommands(onExecute);
    const fixture = newFixture();

    renderContract(fixture);
    act(() => {
      // Emit active (empty) so the widget exits the awaiting-telemetry
      // early-return — without active, offered isn't rendered.
      emitContracts(fixture, {
        active: [],
        offered: [{ id: 7, title: "Survey the Mun", parameters: [] }],
      });
    });

    await user.click(await screen.findByText("Accept"));
    expect(onExecute).toHaveBeenCalledWith("contracts.accept[7]");
  });

  it("requires arm-then-confirm before cancelling an active contract", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    await captureCommands(onExecute);
    const fixture = newFixture();

    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 11, title: "Build a station", parameters: [] }],
      });
    });

    await user.click(await screen.findByText("Cancel"));
    expect(onExecute).not.toHaveBeenCalled();

    await user.click(screen.getByText(/Forfeit contract/i));
    expect(onExecute).toHaveBeenCalledWith("contracts.cancel[11]");
  });

  it("requires arm-then-confirm before declining an offered contract", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    await captureCommands(onExecute);
    const fixture = newFixture();

    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [],
        offered: [{ id: 9, title: "Land on Eve", parameters: [] }],
      });
    });

    // First click arms — should not fire yet.
    await user.click(await screen.findByText("Decline"));
    expect(onExecute).not.toHaveBeenCalled();

    // Confirm fires the decline.
    await user.click(screen.getByText(/Confirm decline/i));
    expect(onExecute).toHaveBeenCalledWith("contracts.decline[9]");
  });

  it("counts active / offered / recent in the subtitle", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 1, title: "A", parameters: [] }],
        offered: [
          { id: 2, title: "B", parameters: [] },
          { id: 3, title: "C", parameters: [] },
        ],
        completedRecent: [{ id: 4, title: "D", parameters: [] }],
      });
    });
    await waitFor(() =>
      expect(
        screen.getByText(/1 active · 2 offered · 1 recent/i),
      ).toBeInTheDocument(),
    );
  });
});

describe("parseContracts", () => {
  it("returns null for non-array input", () => {
    expect(parseContracts(null)).toBeNull();
    expect(parseContracts(undefined)).toBeNull();
    expect(parseContracts({})).toBeNull();
  });

  it("drops entries missing an id", () => {
    const parsed = parseContracts([
      { id: 1, title: "ok" },
      { title: "missing id" },
    ]);
    expect(parsed).toHaveLength(1);
    // IDs are stringified — JS numbers can't represent KSP's full long
    // range, so the parser normalises to string regardless of input type.
    expect(parsed?.[0]?.id).toBe("1");
  });

  it("preserves big-number contract IDs from the new long-as-string fork", () => {
    const parsed = parseContracts([
      { id: "193244571874398123", title: "big id" },
      { id: 690587659210, title: "legacy numeric id" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]?.id).toBe("193244571874398123");
    expect(parsed?.[1]?.id).toBe("690587659210");
  });

  it("collapses unknown parameter states to Incomplete", () => {
    const parsed = parseContracts([
      {
        id: 1,
        title: "Test",
        parameters: [
          { title: "Bad state", state: "Whatever", optional: false },
        ],
      },
    ]);
    expect(parsed?.[0]?.parameters[0]?.state).toBe("Incomplete");
  });
});

describe("formatDeadline", () => {
  it("returns 'no deadline' when the deadline is zero or negative", () => {
    expect(formatDeadline(0, 100)).toBe("no deadline");
    expect(formatDeadline(-1, 100)).toBe("no deadline");
  });

  it("returns 'expired' when current UT has passed the deadline", () => {
    expect(formatDeadline(50, 100)).toBe("expired");
  });

  it("formats days + hours when more than one stock day remains", () => {
    // 5 stock days + 2 stock hours
    const remaining = 5 * 6 * 3600 + 2 * 3600;
    expect(formatDeadline(remaining, 0)).toBe("5d 2h left");
  });

  it("formats hours when less than a stock day remains", () => {
    expect(formatDeadline(3 * 3600, 0)).toBe("3h left");
  });

  it("formats minutes when less than an hour remains", () => {
    expect(formatDeadline(45 * 60, 0)).toBe("45m left");
  });
});
