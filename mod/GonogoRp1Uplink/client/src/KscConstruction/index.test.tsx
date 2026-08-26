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
import { KscConstruction } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.constructions",
  "rp1.centres",
  "career.status",
];

const CENTRES = [
  {
    kscName: "Cape",
    isActive: true,
    engineers: 20,
    unassignedEngineers: 6,
    launchComplexCount: 2,
    anyOperational: true,
    groundStation: "us_cape_canaveral",
  },
];

const CAREER = {
  economy: { funds: 289_848, reputation: 40, science: 12 },
};

/** One construction row, with every key present as the wire carries it. */
function construction(overrides: Record<string, unknown> = {}) {
  return {
    kscName: "Cape",
    lcId: null,
    kind: "FacilityUpgrade",
    name: "VehicleAssemblyBuilding",
    facilityType: "VehicleAssemblyBuilding",
    currentLevel: 2,
    targetLevel: 3,
    isModify: null,
    engineersToReadd: null,
    padId: null,
    progress: 250,
    totalPoints: 1000,
    progressRatio: 0.25,
    workRate: 1,
    rate: 2,
    timeLeftSeconds: 375,
    stalled: false,
    cost: 40_000,
    spentCost: 10_000,
    spentRushCost: 0,
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <KscConstruction />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("KscConstruction", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows a facility upgrade with its levels, its clock and what it has cost", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("career.status", CAREER);
    fixture.emit("rp1.constructions", [construction()]);

    await waitFor(() => {
      expect(screen.getByText("FACILITY")).toBeInTheDocument();
    });
    const text = visibleText();
    expect(text).toContain("VehicleAssemblyBuilding");
    // Money already committed, which is the fact a cancellation turns on.
    expect(text).toContain("10,000");
    expect(text).toContain("40,000");
    // The balance the whole section is spending down.
    expect(text).toContain("289,848");
    await expectNoA11yViolations(view.container);
  });

  it("says plainly that nothing is under construction", async () => {
    // A real state on a fresh career, and one an empty section cannot express:
    // no rows and an Uplink that is not reporting look identical.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("career.status", CAREER);
    fixture.emit("rp1.constructions", []);

    await waitFor(() => {
      expect(screen.getByText("Under construction")).toBeInTheDocument();
    });
    expect(screen.getByText("nothing")).toBeInTheDocument();
  });

  it("distinguishes a complex being modified from a new one", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("career.status", CAREER);
    fixture.emit("rp1.constructions", [
      construction({
        kind: "LaunchComplex",
        name: "LC-2",
        lcId: "lc-2",
        facilityType: null,
        currentLevel: null,
        targetLevel: null,
        isModify: true,
        engineersToReadd: 14,
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("COMPLEX")).toBeInTheDocument();
    });
    const text = visibleText();
    // The fact an operator plans around: the complex is out of service and its
    // engineers are idle until this finishes.
    expect(text).toContain("modification");
    expect(text).toContain("14");
  });

  it("tells an uncosted construction apart from a stalled one", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("career.status", CAREER);
    fixture.emit("rp1.constructions", [
      construction({ name: "Runway", rate: null, timeLeftSeconds: null }),
    ]);

    await waitFor(() => {
      expect(screen.getByText(/Runway/)).toBeInTheDocument();
    });
    expect(visibleText()).toContain("not costed yet");
    expect(screen.queryByText("STALLED")).not.toBeInTheDocument();
  });

  it("calls a throttled-to-zero construction stalled", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("career.status", CAREER);
    fixture.emit("rp1.constructions", [
      construction({
        name: "Runway",
        workRate: 0,
        rate: 0,
        timeLeftSeconds: null,
        stalled: true,
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("STALLED")).toBeInTheDocument();
    });
    expect(visibleText()).not.toContain("not costed yet");
  });

  it("flags a construction being rushed, which costs more per day", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("career.status", CAREER);
    fixture.emit("rp1.constructions", [construction({ workRate: 1.5 })]);

    await waitFor(() => {
      expect(screen.getByText("RUSHING")).toBeInTheDocument();
    });
  });

  it("names the owning centre only when the career has more than one", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", [
      ...CENTRES,
      { ...CENTRES[0], kscName: "Baikonur", isActive: false },
    ]);
    fixture.emit("career.status", CAREER);
    fixture.emit("rp1.constructions", [construction()]);

    await waitFor(() => {
      expect(screen.getByText("FACILITY")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("Cape");
  });

  it("registers itself into the space centre's sections slot", () => {
    const augments = getAugmentsForSlot("space-center-status.sections");
    expect(augments.map((a) => a.id)).toContain("rp1-ksc-construction");
  });
});
