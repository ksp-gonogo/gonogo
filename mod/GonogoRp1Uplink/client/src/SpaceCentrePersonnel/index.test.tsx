import { getComponent } from "@ksp-gonogo/sitrep-sdk";
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
import { SpaceCentrePersonnel } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.personnel",
  "rp1.centres",
  "rp1.complexes",
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

function complexes(overrides: Record<string, unknown> = {}) {
  return [
    {
      kscName: "Cape",
      lcId: "lc-1",
      name: "Pad A",
      lcType: "Pad",
      isOperational: true,
      isRushing: false,
      engineers: 14,
      maxEngineers: 100,
      efficiency: 0.5,
      canIntegrate: true,
      rate: 4,
      humanRated: false,
      massMin: 0,
      massMax: 100,
      ...overrides,
    },
  ];
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <SpaceCentrePersonnel />
    </fixture.Provider>,
  );
  return { fixture, view };
}

describe("SpaceCentrePersonnel", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows the payroll and the per-complex assignment", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.personnel", {
      totalEngineers: 20,
      researchers: 7,
      applicants: 3,
    });
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("rp1.complexes", complexes());

    await waitFor(() => {
      expect(screen.getByText("Researchers")).toBeInTheDocument();
    });
    const text = visibleText();
    expect(text).toContain("Pad A");
    // The assignment, which is the number that decides whether the queue moves.
    expect(text).toContain("14");
    await expectNoA11yViolations(view.container);
  });

  it("flags engineers who are on the payroll and assigned to nothing", async () => {
    // Salary for no work, and invisible everywhere else on the dashboard.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);

    await waitFor(() => {
      expect(screen.getByText("IDLE")).toBeInTheDocument();
    });
  });

  it("does not flag idle when every engineer is assigned", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", [{ ...CENTRES[0], unassignedEngineers: 0 }]);

    await waitFor(() => {
      expect(screen.getByText(/Cape/)).toBeInTheDocument();
    });
    expect(screen.queryByText("IDLE")).not.toBeInTheDocument();
  });

  it("omits efficiency entirely when RP-1 has no record for the complex", async () => {
    // Absent, not zero. A zero would say the crew is hopeless where the truth
    // is that nobody has worked this complex yet.
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("rp1.complexes", complexes({ efficiency: null }));

    await waitFor(() => {
      expect(screen.getByText("Pad A")).toBeInTheDocument();
    });
    expect(visibleText()).not.toContain("efficiency");
  });

  it("flags a rushing complex, which costs more per engineer", async () => {
    const { fixture } = mount();
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", CENTRES);
    fixture.emit("rp1.complexes", complexes({ isRushing: true }));

    await waitFor(() => {
      expect(screen.getByText("RUSHING")).toBeInTheDocument();
    });
  });

  it("registers as a widget of its own and not into the space centre", () => {
    // Both halves asserted, because the move is the point: hiring is not a
    // Space Center overview subject, and the section is not to come back.
    expect(getComponent("rp1-space-centre-personnel")).toBeDefined();
    expect(
      getAugmentsForSlot("space-center-status.sections").map((a) => a.id),
    ).not.toContain("rp1-space-centre-personnel");
  });
});
