import { clearAugments } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  ContractManagerComponent,
  formatDeadline,
  parseContracts,
} from "./index";

/** Commands dispatch at the meta-vantage and are captured on the stream fixture's `transport.sentCommands`. */

interface Contract {
  id: number | string;
  title: string;
  [key: string]: unknown;
}

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
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
    failedRecent?: Contract[];
  },
) {
  fixture.emit("career.status", { contracts });
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  // The data-source teardown does not clear the augment registry, so a test-bound augment would leak.
  clearAugments();
});

describe("ContractManagerComponent", () => {
  it("shows the awaiting placeholder before any telemetry", () => {
    renderContract(newFixture());
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
  });

  it("shows the briefing, difficulty and each objective as a plain item", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [
          {
            id: 7,
            title: "Survey the Mun",
            agent: "Kerbin Space Program",
            state: "Active",
            synopsis: "Visit the Mun and bring the data home",
            briefing: "Our scientists want a closer look at the Mun.",
            notes: "Recover the vessel intact.",
            prestige: "Significant",
            prestigeOrdinal: 1,
            scienceCompletion: 4,
            reputationCompletion: 6,
            parameters: [
              {
                title: "Reach the Mun",
                state: "Complete",
                stateOrdinal: 1,
                optional: false,
                notes: "Any orbit will do",
                children: [
                  {
                    title: "Enter the sphere of influence",
                    state: "Incomplete",
                    stateOrdinal: 0,
                    optional: false,
                    children: [],
                  },
                ],
              },
              {
                title: "Bring a kerbal",
                state: "Failed",
                stateOrdinal: 2,
                optional: true,
                children: [],
              },
            ],
          },
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Survey the Mun")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("img", { name: "Difficulty: 2 of 3" }),
    ).toBeInTheDocument();
    expect(screen.getByText("DIFFICULTY")).toBeInTheDocument();
    expect(
      screen.getByText("Visit the Mun and bring the data home"),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Briefing/ }));
    expect(
      screen.getByText("Our scientists want a closer look at the Mun."),
    ).toBeInTheDocument();
    expect(screen.getByText("Recover the vessel intact.")).toBeInTheDocument();
    expect(screen.getByText("Any orbit will do")).toBeInTheDocument();
    const reach = screen.getByText("Reach the Mun").closest("li");
    expect(reach).not.toHaveTextContent(/Done/);
    const nested = screen
      .getByText("Enter the sphere of influence")
      .closest("li");
    expect(nested).not.toHaveTextContent(/Open/);
    const kerbal = screen.getByText("Bring a kerbal").closest("li");
    expect(kerbal).not.toHaveTextContent(/Failed/);
    expect(kerbal).toHaveTextContent(/optional/);
    expect(visibleText()).toMatch(/4\.0/);
    expect(visibleText()).toMatch(/6\.0/);
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
    // A fact about the board, with no instruction on where to pick one up.
    expect(screen.getByText(/No active contracts/i).textContent).toBe(
      "No active contracts",
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
    expect(visibleText()).toMatch(/25,000/); // fundsCompletion
    expect(screen.getByText(/Land on the Mun/)).toBeInTheDocument();
    expect(screen.getByText(/Plant flag/)).toBeInTheDocument();
    expect(screen.getByText(/Return safely/)).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
    // The ladder drops a zero smaller unit: "5d left", not "5d 0h left".
    expect(visibleText()).toMatch(/5d left/i);
  });

  it("renders the per-contract badges slot with no bound augment (empty is fine)", async () => {
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
      // Without active the widget stays on the awaiting-telemetry return and never renders offered.
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

  it("lists an offered contract's objectives so it can be judged before accepting", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [],
        offered: [
          {
            id: 5,
            title: "Orbit Duna",
            parameters: [
              { title: "Reach Duna orbit", optional: false },
              { title: "Return a crew report", optional: true },
            ],
          },
        ],
      });
    });

    expect(await screen.findByText("Reach Duna orbit")).toBeInTheDocument();
    expect(screen.getByText("Return a crew report")).toBeInTheDocument();
    expect(screen.getByText(/\(optional\)/)).toBeInTheDocument();
  });

  it("shows when an offer is withdrawn, never 'no deadline' for a contract with none yet", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [],
        offered: [
          {
            id: 6,
            title: "Fly by Minmus",
            dateDeadline: 0,
            dateExpire: 3 * 3600,
            parameters: [],
          },
        ],
      });
    });

    await screen.findByText("Fly by Minmus");
    await waitFor(() => expect(visibleText()).toMatch(/offer ends in\s*3\s*h/));
    expect(screen.queryByText("no deadline")).toBeNull();
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

    await user.click(await screen.findByText("Decline"));
    expect(
      fixture.transport.sentCommands.filter(
        (c) => c.command === "career.contract.decline",
      ),
    ).toHaveLength(0);

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

describe("recently failed contracts", () => {
  it("counts them in the subtitle when there are any", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 1, title: "A", parameters: [] }],
        offered: [],
        completedRecent: [],
        failedRecent: [
          { id: 5, title: "E", parameters: [] },
          { id: 6, title: "F", parameters: [] },
        ],
      });
    });
    await waitFor(() =>
      expect(
        screen.getByText(/1 active · 0 offered · 0 recent · 2 failed/i),
      ).toBeInTheDocument(),
    );
  });

  it("says nothing of failures when none are listed", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 1, title: "A", parameters: [] }],
        offered: [],
        completedRecent: [],
        failedRecent: [],
      });
    });
    await waitFor(() =>
      expect(
        screen.getByText(/1 active · 0 offered · 0 recent/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/\d+ failed/i)).toBeNull();
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
    // KSP ids exceed the JS safe-integer range, so the parser normalises every id to a string.
    expect(parsed?.[0]?.id).toBe("1");
  });

  it("preserves big-number contract IDs sent as strings", () => {
    const parsed = parseContracts([
      { id: "193244571874398123", title: "big id" },
      { id: 690587659210, title: "legacy numeric id" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]?.id).toBe("193244571874398123");
    expect(parsed?.[1]?.id).toBe("690587659210");
  });

  /**
   * An unrecognised state collapsed onto `Incomplete` would claim a finished
   * objective is outstanding. Unknown is its own arm, read off the ordinal, so a
   * declared ordinal is that state whatever the name says.
   */
  it("reports an unrecognised parameter state as Unknown, not as Incomplete", () => {
    const parsed = parseContracts([
      {
        id: 1,
        title: "Test",
        parameters: [
          // An ordinal outside KSP's three, as a mod appending to ParameterState would send.
          { title: "Modded state", state: "Waived", stateOrdinal: 7 },
          // No ordinal at all: nothing can say whether it is done.
          { title: "No ordinal", state: "Complete" },
          // A renamed member: the ordinal decides.
          { title: "Renamed", state: "Achieved", stateOrdinal: 1 },
        ],
      },
    ]);
    expect(parsed?.[0]?.parameters.map((p) => p.state)).toEqual([
      "Unknown",
      "Unknown",
      "Complete",
    ]);
  });
});

describe("ContractManagerComponent cancel cost", () => {
  const contract = {
    id: 7,
    title: "Test the booster",
    state: "Active",
    deadlineUt: 0,
    parameters: [],
  };

  it("states what cancelling takes beside the Cancel button", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ ...contract, fundsFailure: 12000, reputationFailure: 6 }],
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/CANCEL COSTS/)).toBeInTheDocument(),
    );
    expect(visibleText()).toMatch(/−.*12,000/);
    expect(visibleText()).toMatch(/−6\.0/);
  });

  it("leaves the cost off when the wire carried no penalty", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, { active: [contract] });
    });
    await screen.findByText(/Test the booster/);
    expect(screen.queryByText(/CANCEL COSTS/)).toBeNull();
  });
});

describe("formatDeadline", () => {
  it("is unknown when the wire carried no deadline", () => {
    expect(formatDeadline(null, 100)).toBe(NULL_DISPLAY);
  });

  it("is unknown, not the whole deadline, when the view UT is unknown", () => {
    expect(formatDeadline(6 * 3600 * 5, undefined)).toBe(NULL_DISPLAY);
    expect(formatDeadline(0, undefined)).toBe("no deadline");
  });

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

describe("finished contracts", () => {
  it("counts what has finished on each state chip", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 1, title: "A", parameters: [] }],
        offered: [],
        completedRecent: [],
        failedRecent: [],
      });
    });
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Active/ })).toHaveTextContent(
      "Active1",
    );
    expect(
      screen.getByRole("button", { name: /^Completed/ }),
    ).toHaveTextContent("Completed0");
    expect(screen.getByRole("button", { name: /^Failed/ })).toHaveTextContent(
      "Failed0",
    );
  });

  it("lists each completed contract with what it paid and each failed one with what it cost", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [{ id: 1, title: "A", parameters: [] }],
        offered: [],
        completedRecent: [
          {
            id: 90,
            title: "Launch a new vessel",
            agent: "Kerbin Space Program",
            fundsCompletion: 3000,
            reputationCompletion: 1,
            parameters: [],
          },
        ],
        failedRecent: [
          {
            id: 51,
            title: "Test the RT-5 Flea",
            agent: "Rockomax Conglomerate",
            fundsFailure: 2000,
            reputationFailure: 2,
            parameters: [],
          },
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Launch a new vessel")).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Completed/ }));
    expect(screen.getByText("Launch a new vessel")).toBeInTheDocument();
    expect(screen.queryByText("Test the RT-5 Flea")).toBeNull();
    expect(visibleText()).toMatch(/3,000/);
    await user.click(screen.getByRole("button", { name: /^Failed/ }));
    expect(screen.getByText("Test the RT-5 Flea")).toBeInTheDocument();
    expect(screen.queryByText("Launch a new vessel")).toBeNull();
    expect(visibleText()).toMatch(/−2,000/);
    expect(visibleText()).toMatch(/−2\.0/);
    expect(visibleText()).toMatch(/Rockomax Conglomerate/);
  });

  it("narrows every state by the typed title", async () => {
    const fixture = newFixture();
    renderContract(fixture);
    act(() => {
      emitContracts(fixture, {
        active: [
          { id: 1, title: "Fly by the Mun", parameters: [] },
          { id: 2, title: "Orbit Kerbin", parameters: [] },
        ],
        offered: [{ id: 3, title: "Land on the Mun", parameters: [] }],
        completedRecent: [],
        failedRecent: [],
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument(),
    );
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "mun");
    expect(screen.getByText("Fly by the Mun")).toBeInTheDocument();
    expect(screen.getByText("Land on the Mun")).toBeInTheDocument();
    expect(screen.queryByText("Orbit Kerbin")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Offered/ }));
    expect(screen.queryByText("Fly by the Mun")).toBeNull();
    expect(screen.getByText("Land on the Mun")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(
      screen.getByText("No contracts match the filter"),
    ).toBeInTheDocument();
  });
});
