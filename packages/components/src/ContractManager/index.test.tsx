import { clearAugments } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  ContractManagerComponent,
  formatDeadline,
  parseContracts,
} from "./index";

/**
 * ContractManager runs off the stream: active/offered/completedRecent all ride
 * the `career.status` Topic's `contracts` sub-tree (canonical `useTelemetry`),
 * and the view UT comes from `useViewUt()` (pinned by the fixture). The
 * accept/cancel/decline commands dispatch through `useCommand` at the
 * meta-vantage; the stream fixture's `transport.sentCommands` captures them.
 */

interface Contract {
  id: number | string;
  title: string;
  [key: string]: unknown;
}

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["career.status", "vessel.state"],
    pinnedUt: 0,
    suspendFrames: true,
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
    expect(visibleText()).toMatch(/25\.0k/); // fundsCompletion
    expect(screen.getByText(/Land on the Mun/)).toBeInTheDocument();
    expect(screen.getByText(/Plant flag/)).toBeInTheDocument();
    expect(screen.getByText(/Return safely/)).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
    // The kit's ladder drops a zero smaller unit, so this reads "5d left"
    // rather than "5d 0h left".
    expect(visibleText()).toMatch(/5d left/i);
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

  it("dispatches career.contract.accept at the meta-vantage when Accept is clicked", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();

    renderContract(fixture);
    act(() => {
      // Emit active (empty) so the widget exits the awaiting-telemetry
      // early-return: without active, offered isn't rendered.
      emitContracts(fixture, {
        active: [],
        offered: [{ id: 7, title: "Survey the Mun", parameters: [] }],
      });
    });

    await user.click(await screen.findByText("Accept"));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.contract.accept",
      );
      expect(sent).toMatchObject({
        args: { contractId: "7" },
        vantage: "meta",
      });
    });
  });

  it("requires arm-then-confirm before cancelling an active contract", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();

    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 11, title: "Build a station", parameters: [] }],
      });
    });

    await user.click(await screen.findByText("Cancel"));
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "career.contract.cancel",
      ),
    ).toHaveLength(0);

    await user.click(screen.getByText(/Forfeit contract/i));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.contract.cancel",
      );
      expect(sent).toMatchObject({
        args: { contractId: "11" },
        vantage: "meta",
      });
    });
  });

  it("requires arm-then-confirm before declining an offered contract", async () => {
    const user = userEvent.setup();
    const fixture = newFixture();

    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [],
        offered: [{ id: 9, title: "Land on Eve", parameters: [] }],
      });
    });

    // First click arms: should not fire yet.
    await user.click(await screen.findByText("Decline"));
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "career.contract.decline",
      ),
    ).toHaveLength(0);

    // Confirm fires the decline.
    await user.click(screen.getByText(/Confirm decline/i));
    await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "career.contract.decline",
      );
      expect(sent).toMatchObject({
        args: { contractId: "9" },
        vantage: "meta",
      });
    });
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
    // IDs are stringified, JS numbers can't represent KSP's full long
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

  /**
   * The pessimistic-arm defect. An unrecognised parameter state used to collapse
   * onto `Incomplete`, which is a CLAIM: it says the objective is outstanding.
   * Rename `ParameterState.Complete` in a future KSP and every finished
   * objective on every contract reads as still to do, with a hollow circle
   * beside it and an offer to set an alarm for something already done.
   *
   * Unknown is its own arm, and the state comes off the ORDINAL. A row whose
   * ordinal is one KSP declares is that state whatever the name says.
   */
  it("reports an unrecognised parameter state as Unknown, not as Incomplete", () => {
    const parsed = parseContracts([
      {
        id: 1,
        title: "Test",
        parameters: [
          // A mod appending to ParameterState: an ordinal outside KSP's three.
          { title: "Modded state", state: "Waived", stateOrdinal: 7 },
          // No ordinal at all: also unknown, and for the same reason - nothing
          // here can say whether it is done.
          { title: "No ordinal", state: "Complete" },
          // A renamed member. The ordinal is what it is.
          { title: "Renamed", state: "Achieved", stateOrdinal: 1 },
        ],
      },
    ]);
    expect(parsed?.[0]?.parameters.map((p) => p.state)).toEqual([
      "Unknown",
      "Unknown",
      "Complete",
    ]);
    // The game's own word survives as a label, so an operator sees what KSP
    // called it rather than only that we could not place it.
    expect(parsed?.[0]?.parameters[0]?.stateLabel).toBe("Waived");
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
    expect(formatDeadline(45 * 60, 0)).toBe("45min left");
  });
});
