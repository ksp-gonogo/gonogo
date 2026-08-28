import {
  getAugmentsForSlot,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { LaunchComplexStatus } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.pads",
  "rp1.complexes",
  "rp1.warehouse",
  "rp1.operations",
];

const SLOT_PROPS = {
  siteName: "Cape Canaveral",
  displayName: "Cape Canaveral LC-1",
  editorFacility: "VAB",
  occupied: null as boolean | null,
  occupantName: null as string | null,
  expanded: true,
  funds: 289_848,
};

function pad(state: string, overrides: Record<string, unknown> = {}) {
  return [
    {
      kscName: "Cape",
      lcId: "lc-1",
      padId: "pad-1",
      name: "LP-1",
      launchSiteName: "Cape Canaveral",
      level: 2,
      fractionalLevel: null,
      state,
      hasVesselWaiting: false,
      waitingVesselName: null,
      ...overrides,
    },
  ];
}

const COMPLEX = [
  {
    kscName: "Cape",
    lcId: "lc-1",
    name: "Pad A",
    lcType: "Pad",
    isOperational: true,
    isRushing: false,
    engineers: 10,
    maxEngineers: 100,
    efficiency: 0.5,
    canIntegrate: true,
    rate: 4,
    humanRated: false,
    massMin: 0,
    massMax: 100,
  },
];

/** One warehoused vehicle, wire-shaped: plain numbers, absences as null. */
function warehoused(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    shipId: "ship-vanguard",
    rolloutRefusals: null,
    kscName: "Cape",
    lcId: "lc-1",
    shipName: "Vanguard",
    cost: 5000,
    mass: 3,
    humanRated: false,
    launchSite: "Cape Canaveral",
    projectType: "VAB",
    ...overrides,
  };
}

/** One pad operation, joined to the pad by NAME, which is what the wire carries. */
function padOp(overrides: Record<string, unknown> = {}) {
  return {
    kscName: "Cape",
    lcId: "lc-1",
    launchPadId: "LP-1",
    type: "Rollout",
    progress: 250,
    totalPoints: 1000,
    progressRatio: 0.25,
    rate: 2,
    timeLeftSeconds: 375,
    stalled: false,
    blockingPeers: 0,
    cost: 5000,
    associatedVesselId: "ship-vanguard",
    ...overrides,
  };
}

function mount(props: Partial<typeof SLOT_PROPS> = {}) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <LaunchComplexStatus {...SLOT_PROPS} {...props} />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("LaunchComplexStatus", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    // Most installs are not RP-1 installs. An augment that renders an empty
    // section on a stock game is clutter that says nothing.
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("names the pad's state and what it means for the launch", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Reconditioning"));
    fixture.emit("rp1.complexes", COMPLEX);

    await waitFor(() => {
      expect(screen.getByText("RECONDITIONING")).toBeInTheDocument();
    });
    // The state alone is RP-1's vocabulary. The sentence is what an operator
    // can act on.
    expect(
      screen.getByText(/being made good after the last launch/),
    ).toBeInTheDocument();
    // The complex is the layer stock has no counterpart for, and is what
    // distinguishes one of a centre's pads from another.
    expect(screen.getByText(/Pad A · Pad/)).toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("says a free pad is clear rather than merely not blocked", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));

    await waitFor(() => {
      expect(screen.getByText("FREE")).toBeInTheDocument();
    });
    expect(screen.getByText(/clear for launch/)).toBeInTheDocument();
    expect(screen.getByText("nothing standing on it")).toBeInTheDocument();
  });

  it("distinguishes a site RP-1 does not model from a pad that is busy", async () => {
    // A stock launch site RP-1 has no complex for is not a blocked pad, and
    // reading as one would send an operator looking for a rollout that does not
    // exist. It is still worth a line: a launch aimed there will not work.
    const { fixture } = mount({ siteName: "Woomera" });
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));

    await waitFor(() => {
      expect(
        screen.getByText(/not an RP-1 launch complex/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("FREE")).not.toBeInTheDocument();
  });

  /**
   * The defect this section was rekeyed to dissolve.
   *
   * A rollout that has FINISHED leaves the vehicle in the warehouse list and
   * takes its operation away, so a section reading the warehouse alone reported
   * "BUILT, in the warehouse, ready to roll out" for a vehicle the operator
   * could see standing on the pad. RP-1 answers the question separately, through
   * `LCLaunchPad.HasVesselWaitingToBeLaunched`, and that is what the pad's row
   * reads now.
   */
  it("says a vehicle standing on the pad is standing on it, not warehoused", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit(
      "rp1.pads",
      pad("Free", { hasVesselWaiting: true, waitingVesselName: "Vanguard" }),
    );
    fixture.emit("rp1.complexes", COMPLEX);
    fixture.emit("rp1.operations", []);
    fixture.emit("rp1.warehouse", [warehoused()]);

    await waitFor(() => {
      expect(screen.getByText("AT PAD")).toBeInTheDocument();
    });
    expect(screen.getByText("Vanguard is standing on it")).toBeInTheDocument();
    expect(
      screen.queryByText(/in the warehouse, ready to roll out/),
    ).not.toBeInTheDocument();
    await expectNoA11yViolations(view.container);
  });

  it("shows a rollout in progress with the vehicle it is carrying and its ETA", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Rollout"));
    fixture.emit("rp1.complexes", COMPLEX);
    fixture.emit("rp1.operations", [padOp()]);
    fixture.emit("rp1.warehouse", [warehoused()]);

    await waitFor(() => {
      expect(screen.getByText("ROLLING OUT")).toBeInTheDocument();
    });
    expect(screen.getByText("Vanguard is on its way out")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", {
      name: /Pad operation progress, LP-1/,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    await expectNoA11yViolations(view.container);
  });

  it("says NOT COSTED rather than stalled when RP-1 has not priced the operation", async () => {
    // The distinction the payload keeps as two facts, kept as two here: this is
    // "ask again next tick", not "going nowhere".
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Rollout"));
    fixture.emit("rp1.operations", [
      padOp({ rate: null, timeLeftSeconds: null, stalled: false }),
    ]);
    fixture.emit("rp1.warehouse", [warehoused()]);

    await waitFor(() => {
      expect(screen.getByText(/not costed yet/)).toBeInTheDocument();
    });
    expect(screen.queryByText("STALLED")).not.toBeInTheDocument();
  });

  it("says STALLED when the operation is costed and going nowhere", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Rollout"));
    fixture.emit("rp1.operations", [
      padOp({ rate: 0, timeLeftSeconds: null, stalled: true }),
    ]);
    fixture.emit("rp1.warehouse", [warehoused()]);

    await waitFor(() => {
      expect(screen.getByText("STALLED")).toBeInTheDocument();
    });
    expect(screen.queryByText(/not costed yet/)).not.toBeInTheDocument();
  });

  it("does not report an unanswered occupancy as an empty pad", async () => {
    // Null is "the question could not be answered", which is a different fact
    // from no vehicle, and the mod re-checks it at the moment of the press.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free", { hasVesselWaiting: null }));
    fixture.emit("rp1.operations", []);

    await waitFor(() => {
      expect(
        screen.getByText(/did not say whether a vehicle is waiting/),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByText("nothing standing on it"),
    ).not.toBeInTheDocument();
  });

  it("collapses to one line on a pad row the operator has not opened", async () => {
    // Every pad row carries this section, so an unopened one has to be a line
    // rather than a block, or a space centre with six pads is unreadable.
    const { fixture } = mount({ expanded: false });
    fixture.emit("rp1.available", true);
    fixture.emit(
      "rp1.pads",
      pad("Free", { hasVesselWaiting: true, waitingVesselName: "Vanguard" }),
    );
    fixture.emit("rp1.complexes", COMPLEX);

    await waitFor(() => {
      expect(screen.getByText("AT PAD")).toBeInTheDocument();
    });
    expect(screen.getByText(/Vanguard is standing on it/)).toBeInTheDocument();
    // No section chrome, and no progressbar: the row is one line.
    expect(screen.queryByText("RP-1 LAUNCH COMPLEX")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("registers itself into the launch director's per-pad slot", () => {
    // The registration is a side effect of importing this module, which is how
    // the app loads it, so this is the test that the augment is reachable at
    // all rather than merely defined.
    const augments = getAugmentsForSlot("launch-director.pad");
    expect(augments.map((a) => a.id)).toContain("rp1-launch-complex-status");
  });
});
