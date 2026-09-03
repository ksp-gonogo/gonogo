import {
  getAugmentsForSlot,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { CrewTrainingBadge } from "./badge";

const TOPICS = ["rp1.available", "rp1.crew"];

function crewRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "Wernher Kerman",
    retired: false,
    trainingCourse: null,
    trainingType: null,
    trainingTarget: null,
    trainingStarted: null,
    ...overrides,
  };
}

function mountBadge(kerbalName = "Wernher Kerman") {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <CrewTrainingBadge
        isApplicant={false}
        kerbalName={kerbalName}
        standing={null}
      />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("the corner mark on a kerbal's card", () => {
  /**
   * The whole reason this is a corner mark rather than a line in the block
   * below: a kerbal RP-1 has on a course still reads `Available` to KSP's own
   * roster, so they sit in the Available tab looking like anybody else, and the
   * one fact that says otherwise has to be visible while scanning the names.
   */
  it("marks a kerbal whose course is running", async () => {
    const { fixture, view } = mountBadge();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crew", [
      crewRow({
        trainingCourse: "TRAINING_mission-Mun",
        trainingStarted: true,
        trainingTarget: "Mun",
        trainingType: "Mission",
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("TRAINING")).toBeInTheDocument();
    });
    await expectNoA11yViolations(view.container);
  });

  /**
   * Enrolment and progress are separate facts, and the corner has to keep them
   * apart: RP-1 lets a course sit unstarted indefinitely, and a kerbal marked as
   * training who is not being trained is the one reading that would cost a
   * flight.
   */
  it("tells an enrolled kerbal from one whose course is running", async () => {
    const { fixture } = mountBadge();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crew", [
      crewRow({
        trainingCourse: "TRAINING_proficiency-LR79",
        trainingStarted: false,
        trainingTarget: "LR79",
        trainingType: "Proficiency",
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("ENROLLED")).toBeInTheDocument();
    });
    expect(screen.queryByText("TRAINING")).not.toBeInTheDocument();
  });

  it("marks nobody who is not on a course", async () => {
    const { fixture, view } = mountBadge();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crew", [crewRow()]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.crew")).toBe(true);
    });
    expect(visibleText(view.container)).toBe("");
  });

  it("marks nobody on a stock game", async () => {
    const { fixture, view } = mountBadge();
    fixture.emit("rp1.available", false);
    fixture.emit("rp1.crew", [
      crewRow({
        trainingCourse: "TRAINING_mission-Mun",
        trainingStarted: true,
      }),
    ]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(visibleText(view.container)).toBe("");
  });

  it("marks nobody RP-1 is not scheduling", async () => {
    const { fixture, view } = mountBadge("Jebediah Kerman");
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.crew", [
      crewRow({
        trainingCourse: "TRAINING_mission-Mun",
        trainingStarted: true,
      }),
    ]);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.crew")).toBe(true);
    });
    expect(visibleText(view.container)).toBe("");
  });

  it("registers itself into the Astronaut Complex's crew-card corner", () => {
    const augments = getAugmentsForSlot("astronaut-complex.crew-badge");
    expect(augments.map((a) => a.id)).toContain("rp1-crew-training-badge");
  });
});
