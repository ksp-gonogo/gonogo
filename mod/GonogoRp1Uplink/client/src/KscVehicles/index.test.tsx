import {
  act,
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
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { KscVehicles, RP1_BUILD_REPEAT_COMMAND } from "./index";

const TOPICS = [
  "rp1.available",
  "rp1.warehouse",
  "rp1.buildQueue",
  "rp1.complexes",
  "career.status",
  RP1_BUILD_REPEAT_COMMAND,
];

const CAREER = {
  economy: { funds: 289_848, reputation: 40, science: 12 },
};

const COMPLEXES = [
  { kscName: "Cape", lcId: "lc-1", name: "LC-1", isOperational: true },
];

/** One finished vehicle, with every key present as the wire carries it. */
function built(overrides: Record<string, unknown> = {}) {
  return {
    id: "vp-atlas-1",
    kscName: "Cape",
    lcId: "lc-1",
    shipName: "Atlas",
    cost: 40_000,
    mass: 120,
    humanRated: false,
    launchSite: "LaunchPad",
    projectType: "VAB",
    ...overrides,
  };
}

/** One vehicle still on the build list. */
function integrating(overrides: Record<string, unknown> = {}) {
  return {
    ...built({ id: "vp-atlas-2" }),
    progress: 250,
    totalPoints: 1000,
    progressRatio: 0.25,
    rate: 2,
    timeLeftSeconds: 375,
    stalled: false,
    ...overrides,
  };
}

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <KscVehicles />
    </fixture.Provider>,
  );
  return { fixture, view };
}

/** A centre with one finished Atlas and nothing else. */
function withOneBuiltVehicle() {
  const mounted = mount();
  act(() => {
    mounted.fixture.emit("rp1.available", true);
    mounted.fixture.emit("career.status", CAREER);
    mounted.fixture.emit("rp1.complexes", COMPLEXES);
    mounted.fixture.emit("rp1.buildQueue", []);
    mounted.fixture.emit("rp1.warehouse", [built()]);
  });
  return mounted;
}

describe("KscVehicles", () => {
  it("renders nothing at all until RP-1 says it is there", async () => {
    const { fixture, view } = mount();
    fixture.emit("rp1.available", false);

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows the funds balance the build it offers will be spent from", async () => {
    // The repo rule for any widget with a fund-spending control, and it is not
    // decoration: the mod prices the build against this balance, so an operator
    // reading a refusal is reading the same number the refusal compared against.
    const { view } = withOneBuiltVehicle();

    await waitFor(() => {
      expect(screen.getByText("Funds")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("289,848");
    await expectNoA11yViolations(view.container);
  });

  it("says plainly that the centre holds no vehicles at all", async () => {
    // A real state on a fresh career, and one an empty section cannot express:
    // no rows and an Uplink that is not reporting look identical.
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(
        screen.getByText("none built and none on order"),
      ).toBeInTheDocument();
    });
  });

  it("offers a repeat build for a finished vehicle and for one still integrating", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", [integrating()]);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(screen.getByText("INTEGRATING")).toBeInTheDocument();
    // Two rows of the SAME design name, which is the ordinary case this widget
    // exists to serve, so both controls have to be reachable and distinct.
    expect(
      screen.getAllByRole("button", { name: /^Build another/ }),
    ).toHaveLength(2);
  });

  it("dispatches rp1.build.repeat with the vehicle id only after arm-then-confirm", async () => {
    const user = userEvent.setup();
    const { fixture } = withOneBuiltVehicle();

    await user.click(
      await screen.findByRole("button", { name: "Build another Atlas" }),
    );
    // Arm first: this spends career funds, and one press must not commit it.
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_BUILD_REPEAT_COMMAND,
      ),
    ).toBeUndefined();

    await user.click(
      screen.getByRole("button", { name: "Confirm building another Atlas" }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_BUILD_REPEAT_COMMAND,
    );
    expect(sent).toBeDefined();
    // The id, never the name: two vehicles of this design would answer to the
    // name and the mod would have to guess which.
    expect(sent?.args).toEqual({ id: "vp-atlas-1" });
  });

  it("addresses the right one of two vehicles that share a name", async () => {
    const user = userEvent.setup();
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.warehouse", [
        built({ id: "vp-atlas-1" }),
        built({ id: "vp-atlas-2" }),
      ]);
      fixture.emit("rp1.buildQueue", []);
    });

    const controls = await screen.findAllByRole("button", {
      name: "Build another Atlas",
    });
    await user.click(controls[1]);
    await user.click(
      screen.getAllByRole("button", {
        name: "Confirm building another Atlas",
      })[0],
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_BUILD_REPEAT_COMMAND,
    );
    expect(sent?.args).toEqual({ id: "vp-atlas-2" });
  });

  it("says a vehicle RP-1 gave no id to cannot be repeated, rather than offering to guess", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", COMPLEXES);
      fixture.emit("rp1.warehouse", [built({ id: null })]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("Build another")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("RP-1 has no id for this vehicle");
    expect(
      screen.queryByRole("button", { name: /^Build another/ }),
    ).not.toBeInTheDocument();
  });

  it("names the complex only when the centre has more than one", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("rp1.available", true);
      fixture.emit("career.status", CAREER);
      fixture.emit("rp1.complexes", [
        ...COMPLEXES,
        { kscName: "Cape", lcId: "lc-2", name: "LC-2", isOperational: true },
      ]);
      fixture.emit("rp1.warehouse", [built()]);
      fixture.emit("rp1.buildQueue", []);
    });

    await waitFor(() => {
      expect(screen.getByText("BUILT")).toBeInTheDocument();
    });
    expect(visibleText()).toContain("Atlas · LC-1");
  });

  it("registers itself into the space centre's section slot", () => {
    const ids = getAugmentsForSlot("space-center-status.sections").map(
      (a) => a.id,
    );
    expect(ids).toContain("rp1-ksc-vehicles");
  });
});
