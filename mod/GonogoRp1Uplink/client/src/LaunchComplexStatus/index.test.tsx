import {
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { getAugmentsForSlot } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { LaunchComplexStatus } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.pads",
  "rp1.complexes",
  "rp1.buildQueue",
  "rp1.warehouse",
];

const SLOT_PROPS = {
  scene: "SpaceCenter",
  inFlight: false,
  selectedShip: null as string | null,
  selectedSite: "Cape Canaveral",
  selectedCrew: [] as string[],
  funds: 289_848,
};

function pad(state: string) {
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

/** A build-list vehicle, wire-shaped: plain numbers, absences as null. */
function queued(overrides: Record<string, unknown> = {}) {
  return [
    {
      kscName: "Cape",
      lcId: "lc-1",
      shipName: "Vanguard",
      progress: 250,
      totalPoints: 1000,
      progressRatio: 0.25,
      rate: 2,
      timeLeftSeconds: 375,
      stalled: false,
      cost: 5000,
      mass: 3,
      humanRated: false,
      launchSite: "Cape Canaveral",
      projectType: "VAB",
      ...overrides,
    },
  ];
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
  });

  it("distinguishes no matching pad from a pad that is busy", async () => {
    // A site RP-1 has no pad for is not a blocked pad, and reading as one would
    // send an operator looking for a rollout that does not exist.
    const { fixture } = mount({ selectedSite: "Woomera" });
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));

    await waitFor(() => {
      expect(
        screen.getByText(/no RP-1 pad matches this site/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("FREE")).not.toBeInTheDocument();
  });

  it("says the selected craft is not built when no vehicle of that name exists", async () => {
    // The stock picker lists craft FILES. Under RP-1 a craft file is not a
    // vehicle, and this is the only place that difference is visible.
    const { fixture } = mount({ selectedShip: "Atlas" });
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));
    fixture.emit("rp1.warehouse", []);
    fixture.emit("rp1.buildQueue", []);

    await waitFor(() => {
      expect(screen.getByText("NOT BUILT")).toBeInTheDocument();
    });
  });

  it("says a warehoused craft is built and ready to roll out", async () => {
    const { fixture } = mount({ selectedShip: "Ready One" });
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));
    fixture.emit("rp1.warehouse", [
      {
        kscName: "Cape",
        lcId: "lc-1",
        shipName: "Ready One",
        cost: 5000,
        mass: 3,
        humanRated: false,
        launchSite: "Cape Canaveral",
        projectType: "VAB",
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
  });

  it("shows an integrating craft's countdown and progress", async () => {
    const { fixture, view } = mount({ selectedShip: "Vanguard" });
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));
    fixture.emit("rp1.complexes", COMPLEX);
    fixture.emit("rp1.buildQueue", queued());

    await waitFor(() => {
      expect(screen.getByText("INTEGRATING")).toBeInTheDocument();
    });
    // A progress bar the operator can read, announced as one.
    const bar = screen.getByRole("progressbar", {
      name: /Integration progress, Vanguard/,
    });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
    await expectNoA11yViolations(view.container);
  });

  it("says NOT COSTED rather than stalled when RP-1 has not priced the project", async () => {
    // The distinction the payload keeps as two facts, kept as two here: this is
    // "ask again next tick", not "going nowhere".
    const { fixture } = mount({ selectedShip: "Sputnik" });
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));
    fixture.emit(
      "rp1.buildQueue",
      queued({
        shipName: "Sputnik",
        rate: null,
        timeLeftSeconds: null,
        stalled: false,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/not costed yet/)).toBeInTheDocument();
    });
    expect(screen.queryByText("STALLED")).not.toBeInTheDocument();
  });

  it("says STALLED when the project is costed and going nowhere", async () => {
    const { fixture } = mount({ selectedShip: "Atlas" });
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.pads", pad("Free"));
    fixture.emit(
      "rp1.buildQueue",
      queued({
        shipName: "Atlas",
        rate: 0,
        timeLeftSeconds: null,
        stalled: true,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("STALLED")).toBeInTheDocument();
    });
    expect(screen.queryByText(/not costed yet/)).not.toBeInTheDocument();
  });

  it("registers itself into the launch director's pre-flight slot", () => {
    // The registration is a side effect of importing this module, which is how
    // the app loads it, so this is the test that the augment is reachable at
    // all rather than merely defined.
    const augments = getAugmentsForSlot("launch-director.preflight");
    expect(augments.map((a) => a.id)).toContain("rp1-launch-complex-status");
  });
});
