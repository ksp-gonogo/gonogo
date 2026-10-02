import {
  getAugmentsForSlot,
  type MissionObjectiveState,
  type MissionStatus,
  type ObjectiveSlotSection,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
  wrapWire,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  MissionObjectivesSource,
  MissionStatusLine,
  missionObjectiveItems,
} from "./index";

// A stand-in for the Objectives widget's `Section`, which this client cannot import.
function Section({ items }: ObjectiveSlotSection) {
  return (
    <ul aria-label="objectives">
      {items.map((o) => (
        <li key={o.id} data-state={o.state}>
          {o.source}: {o.title}
          {o.description ? ` (${o.description})` : ""}
        </li>
      ))}
    </ul>
  );
}

const RAW = {
  name: "First Steps",
  phase: "Reach orbit",
  started: true,
  finished: false,
  succeeded: false,
  scoreEnabled: true,
  score: 150,
  maxScore: 1000,
  objectives: [
    {
      id: "a",
      title: "Leave the pad",
      description: "Lift off",
      state: 2,
    },
    { id: "b", title: "Reach orbit", state: 1 },
    { id: "c", title: "Land safely", state: 0 },
    { id: "d", title: "Stay alive", state: 3 },
  ],
};

// The wire carries plain numbers and the client reads them wrapped, so the pure functions get the wrapped form.
const MISSION = wrapWire<MissionStatus>("MissionStatus", structuredClone(RAW));

describe("missionObjectiveItems", () => {
  it("maps each objective in order, tagged by the mission", () => {
    const items = missionObjectiveItems(MISSION);

    expect(items.map((i) => [i.id, i.state, i.source])).toEqual([
      ["mh:a", "reached", "First Steps"],
      ["mh:b", "active", "First Steps"],
      ["mh:c", "pending", "First Steps"],
      ["mh:d", "failed", "First Steps"],
    ]);
    expect(items[0].description).toBe("Lift off");
    expect(items[1]).not.toHaveProperty("description");
  });

  it("reads a withheld state as pending, never reached or failed", () => {
    const items = missionObjectiveItems({
      objectives: [{}],
    });

    expect(items).toEqual([
      { id: "mh:0:", title: "Objective", state: "pending", source: "Mission" },
    ]);
  });

  it("gives an unknown ordinal the pending reading too", () => {
    const [item] = missionObjectiveItems({
      name: "M",
      objectives: [{ id: "x", title: "T", state: 99 as MissionObjectiveState }],
    });

    expect(item.state).toBe("pending");
  });

  it("yields nothing for no mission, or one with no objective list", () => {
    expect(missionObjectiveItems(null)).toEqual([]);
    expect(missionObjectiveItems(undefined)).toEqual([]);
    expect(missionObjectiveItems({ name: "M" })).toEqual([]);
  });
});

describe("MissionStatusLine", () => {
  const line = (mission: MissionStatus) =>
    render(<MissionStatusLine mission={mission} />).container.textContent;

  it("names the phase and score of a running mission", () => {
    expect(line(MISSION)).toBe("Phase: Reach orbit · Score 150 / 1000");
  });

  it("reports the outcome of a finished mission over its phase", () => {
    expect(line({ ...MISSION, finished: true, succeeded: true })).toBe(
      "Mission complete · Score 150 / 1000",
    );
    expect(line({ ...MISSION, finished: true, succeeded: false })).toBe(
      "Mission failed · Score 150 / 1000",
    );
  });

  it("leaves the score out when the mission awards none, and says when it has not started", () => {
    expect(line({ ...MISSION, started: false, scoreEnabled: false })).toBe(
      "Not started",
    );
  });

  it("draws nothing when there is neither a phase nor a score", () => {
    expect(line({ ...MISSION, phase: undefined, scoreEnabled: false })).toBe(
      "",
    );
  });
});

describe("MissionObjectivesSource", () => {
  it("binds objectives.source ahead of the contracts source", () => {
    const ours = getAugmentsForSlot("objectives.source").find(
      (a) => a.id === "objectives-making-history",
    );

    expect(ours?.priority).toBeLessThan(20);
  });

  it("renders nothing until a mission frame arrives", () => {
    const fixture = setupStreamFixture({ pinnedUt: 10 });

    const { container } = render(
      <MissionObjectivesSource Section={Section} />,
      {
        wrapper: fixture.Provider,
      },
    );

    expect(fixture.transport.isSubscribed("missions.active")).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the running mission's objectives off the stream", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10 });

    const { container } = render(
      <MissionObjectivesSource Section={Section} />,
      {
        wrapper: fixture.Provider,
      },
    );
    act(() => {
      fixture.emit("missions.active", RAW);
    });

    expect(await screen.findByText(/Leave the pad/)).toBeInTheDocument();
    expect(container.textContent).toContain(
      "Phase: Reach orbit · Score 150 / 1000",
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual([
      "reached",
      "active",
      "pending",
      "failed",
    ]);
    await expectNoA11yViolations(container);
  });

  it("clears the rows when the mission ends", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10 });

    const { container } = render(
      <MissionObjectivesSource Section={Section} />,
      {
        wrapper: fixture.Provider,
      },
    );
    act(() => {
      fixture.emit("missions.active", RAW);
    });
    expect(await screen.findByText(/Leave the pad/)).toBeInTheDocument();

    act(() => {
      fixture.emit("missions.active", null);
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
