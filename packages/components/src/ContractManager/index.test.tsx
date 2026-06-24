import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  ContractManagerComponent,
  formatDeadline,
  parseContracts,
} from "./index";

const KEYS: DataKey[] = [
  { key: "contracts.active" },
  { key: "contracts.offered" },
  { key: "contracts.completedRecent" },
  { key: "t.universalTime" },
];

describe("ContractManagerComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the awaiting placeholder before any telemetry", () => {
    render(<ContractManagerComponent config={{}} id="md" />);
    expect(
      screen.getByText(/Awaiting contract telemetry/i),
    ).toBeInTheDocument();
  });

  it("shows empty-state copy when there are no active contracts", () => {
    render(<ContractManagerComponent config={{}} id="md" />);
    act(() => {
      source.emit("contracts.active", []);
    });
    expect(screen.getByText(/No active contracts/i)).toBeInTheDocument();
  });

  it("renders an active contract with parameters and rewards", () => {
    render(<ContractManagerComponent config={{}} id="md" />);
    act(() => {
      source.emit("t.universalTime", 0);
      source.emit("contracts.active", [
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
      ]);
    });
    expect(screen.getByText(/Plant a flag on the Mun/i)).toBeInTheDocument();
    expect(screen.getByText(/Kerbin Space Program/)).toBeInTheDocument();
    expect(screen.getByText(/25\.0k/)).toBeInTheDocument(); // fundsCompletion
    expect(screen.getByText(/Land on the Mun/)).toBeInTheDocument();
    expect(screen.getByText(/Plant flag/)).toBeInTheDocument();
    expect(screen.getByText(/Return safely/)).toBeInTheDocument();
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
    expect(screen.getByText(/5d 0h left/i)).toBeInTheDocument();
  });

  it("fires contracts.accept when the Accept button on an offered contract is clicked", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<ContractManagerComponent config={{}} id="md" />);
    act(() => {
      // Emit active first so the widget exits the awaiting-telemetry
      // early-return — without active, offered isn't rendered.
      source.emit("contracts.active", []);
      source.emit("contracts.offered", [
        { id: 7, title: "Survey the Mun", parameters: [] },
      ]);
    });

    await user.click(screen.getByText("Accept"));
    expect(onExecute).toHaveBeenCalledWith("contracts.accept[7]");
  });

  it("requires arm-then-confirm before cancelling an active contract", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<ContractManagerComponent config={{}} id="md" />);
    act(() => {
      source.emit("contracts.active", [
        { id: 11, title: "Build a station", parameters: [] },
      ]);
    });

    await user.click(screen.getByText("Cancel"));
    expect(onExecute).not.toHaveBeenCalled();

    await user.click(screen.getByText(/Forfeit contract/i));
    expect(onExecute).toHaveBeenCalledWith("contracts.cancel[11]");
  });

  it("requires arm-then-confirm before declining an offered contract", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<ContractManagerComponent config={{}} id="md" />);
    act(() => {
      source.emit("contracts.active", []);
      source.emit("contracts.offered", [
        { id: 9, title: "Land on Eve", parameters: [] },
      ]);
    });

    // First click arms — should not fire yet.
    await user.click(screen.getByText("Decline"));
    expect(onExecute).not.toHaveBeenCalled();

    // Confirm fires the decline.
    await user.click(screen.getByText(/Confirm decline/i));
    expect(onExecute).toHaveBeenCalledWith("contracts.decline[9]");
  });

  it("counts active / offered / recent in the subtitle", () => {
    render(<ContractManagerComponent config={{}} id="md" />);
    act(() => {
      source.emit("contracts.active", [
        {
          id: 1,
          title: "A",
          parameters: [],
        },
      ]);
      source.emit("contracts.offered", [
        { id: 2, title: "B", parameters: [] },
        { id: 3, title: "C", parameters: [] },
      ]);
      source.emit("contracts.completedRecent", [
        { id: 4, title: "D", parameters: [] },
      ]);
    });
    expect(
      screen.getByText(/1 active · 2 offered · 1 recent/i),
    ).toBeInTheDocument();
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
