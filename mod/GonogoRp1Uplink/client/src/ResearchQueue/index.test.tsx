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
import { ResearchQueue } from "./index";

const TOPICS = ["rp1.available", "rp1.research"];

function node(overrides: Record<string, unknown> = {}) {
  return {
    techId: "start",
    techName: "Basic Rocketry",
    scienceCost: 100,
    progress: 20,
    progressRatio: 0.2,
    workRate: 1,
    rate: 2,
    timeLeftSeconds: 40,
    stalled: false,
    startYear: 1951,
    endYear: 1960,
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <ResearchQueue />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("ResearchQueue", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("says researchers are idle on an empty queue, which is not the same as absent", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.research", []);

    await waitFor(() => {
      expect(screen.getByText(/Researchers are idle/)).toBeInTheDocument();
    });
  });

  it("shows a queued node's countdown, progress and era", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.research", [node()]);

    await waitFor(() => {
      expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    });
    const text = visibleText();
    // The era model has no stock counterpart, and it is why a node costs what
    // it costs.
    expect(text).toContain("1951");
    expect(text).toContain("1960");
    expect(
      screen.getByRole("progressbar", {
        name: /Research progress, Basic Rocketry/,
      }),
    ).toHaveAttribute("aria-valuenow", "20");
    await expectNoA11yViolations(view.container);
  });

  it("omits the era entirely when RP-1 records none, rather than showing year zero", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.research", [node({ startYear: null, endYear: null })]);

    await waitFor(() => {
      expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    });
    expect(screen.queryByText("Era")).not.toBeInTheDocument();
  });

  it("shows the throttle only when the operator has moved it", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.research", [node({ workRate: 0.5 })]);

    await waitFor(() => {
      expect(screen.getByText(/throttled to/)).toBeInTheDocument();
    });
  });

  it("does not mention the throttle on a node running at full rate", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.research", [node()]);

    await waitFor(() => {
      expect(screen.getByText("Basic Rocketry")).toBeInTheDocument();
    });
    expect(screen.queryByText(/throttled to/)).not.toBeInTheDocument();
  });

  it("says NOT COSTED rather than stalled on a node RP-1 has not priced", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.research", [
      node({ rate: null, timeLeftSeconds: null, stalled: false }),
    ]);

    await waitFor(() => {
      expect(screen.getByText(/not costed yet/)).toBeInTheDocument();
    });
    expect(screen.queryByText("STALLED")).not.toBeInTheDocument();
  });

  it("registers itself into the tech tree's universal sections segment", () => {
    // The seam needed no first-party change: Panel mounts
    // `${componentId}.sections` for every widget.
    const augments = getAugmentsForSlot("tech-tree.sections");
    expect(augments.map((a) => a.id)).toContain("rp1-research-queue");
  });
});
