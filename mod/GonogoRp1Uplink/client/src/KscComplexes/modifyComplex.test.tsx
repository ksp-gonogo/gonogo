import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { KscComplexes } from "./index";
import { RP1_COMPLEX_MODIFY_COMMAND } from "./Modify";

const TOPICS = [
  "career.status",
  "rp1.available",
  "rp1.centres",
  "rp1.complexes",
  "rp1.pads",
  "rp1.personnel",
  RP1_COMPLEX_MODIFY_COMMAND,
];

const CAPE = {
  anyOperational: true,
  engineers: 30,
  isActive: true,
  kscName: "Cape",
  launchComplexCount: 1,
  unassignedEngineers: 6,
};

const LC1 = {
  canIntegrate: true,
  engineers: 18,
  humanRated: false,
  isOperational: true,
  kscName: "Cape",
  launchPadCount: 1,
  lcId: "lc-1",
  lcType: "Pad",
  massMax: 100,
  massOrig: 100,
  maxEngineers: 60,
  name: "LC-1",
  resourceCapacities: {},
  resourcesHandled: [],
  sizeMaxDepth: 10,
  sizeMaxHeight: 20,
  sizeMaxWidth: 10,
};

function mount(
  complex: Record<string, unknown> = LC1,
  funds: number | null = 120_000,
) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <KscComplexes />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("rp1.available", true);
    fixture.emit("rp1.centres", [CAPE]);
    fixture.emit("rp1.complexes", [complex]);
    fixture.emit("rp1.pads", []);
    fixture.emit("rp1.personnel", { applicants: 0, researchers: 3 });
    if (funds !== null) {
      fixture.emit("career.status", { economy: { funds } });
    }
  });
  return { fixture, view };
}

async function openRenovation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Detail for LC-1" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Renovate LC-1" }),
  );
}

describe("renovating a launch complex", () => {
  it("queues the renovation with the complex's fluids sent back unchanged", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount({
      ...LC1,
      resourceCapacities: { Kerosene: 1500, LqdOxygen: 3000 },
      resourcesHandled: ["Kerosene", "LqdOxygen"],
    });
    await openRenovation(user);

    const tonnage = await screen.findByLabelText("Tonnage limit");
    await user.clear(tonnage);
    await user.type(tonnage, "180");
    await user.click(
      await screen.findByRole("button", {
        name: "Queue the renovation of LC-1",
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^Confirm renovating LC-1/ }),
    );

    /*
     * The fluids are the assertion. `Rp1ComplexModifyArgs.resources` is a SET and
     * ABSENT MEANS NONE, so a renovation that says nothing about them strips
     * every one: RP-1 prices the removal, strands any vehicle that needed the
     * fluid, and leaves a complex that cannot fuel what it was built for. A
     * client that means "keep these" has to send them.
     */
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_COMPLEX_MODIFY_COMMAND,
      )?.args,
    ).toEqual({
      assignEngineersOnComplete: false,
      humanRated: false,
      lcId: "lc-1",
      massMax: 180,
      resources: { Kerosene: 1500, LqdOxygen: 3000 },
      size: { sizeMaxDepth: 10, sizeMaxHeight: 20, sizeMaxWidth: 10 },
    });
    await expectNoA11yViolations(view.container);
  });

  it("is absent when RP-1 has not said what fluids the complex holds", async () => {
    const user = userEvent.setup();
    const { complexWithout } = { complexWithout: { ...LC1 } };
    delete (complexWithout as Record<string, unknown>).resourceCapacities;
    mount(complexWithout);

    await user.click(
      await screen.findByRole("button", { name: "Detail for LC-1" }),
    );
    /*
     * Absent is not empty. Renovating on a guess of "no fluids" would strip
     * whatever the complex actually holds, so there is no control rather than a
     * control that can only be wrong.
     */
    expect(
      screen.queryByRole("button", { name: "Renovate LC-1" }),
    ).not.toBeInTheDocument();
  });

  it("prices the renovation, and says a short balance slows it rather than stopping it", async () => {
    const user = userEvent.setup();
    const { view } = mount(LC1, 2_000);
    await openRenovation(user);

    const tonnage = await screen.findByLabelText("Tonnage limit");
    await user.clear(tonnage);
    await user.type(tonnage, "180");

    /*
     * The spend model. A construction is not a purchase: the project goes on
     * RP-1's queue and funds are drawn as it builds, at a rate that FALLS when
     * the career is short. So a balance that does not cover it is a pace
     * problem, and "cannot afford" would be a falsehood.
     */
    await waitFor(() => {
      expect(view.container.textContent).toContain(
        "more than the balance, so it builds slower",
      );
    });
    expect(view.container.textContent).not.toMatch(/cannot afford/i);
  });

  it("refuses to quote a two-pad complex until RP-1 has priced an extra pad", async () => {
    const user = userEvent.setup();
    const { view } = mount({ ...LC1, launchPadCount: 2 });
    await openRenovation(user);

    /*
     * A renovation reprices every pad the complex already has, and the multiplier
     * it does that by is RP-1's own setting on `rp1.lcPricing`, absent from this
     * scene. Absent is not the shipped default: a career whose setting has been
     * retuned would be quoted against a figure RP-1 does not use.
     */
    await waitFor(() => {
      expect(view.container.textContent).toContain(
        "no price: RP-1 has not said what this would cost",
      );
    });
  });

  it("charges for a shrink and says so rather than implying a refund", async () => {
    const user = userEvent.setup();
    const { view } = mount({ ...LC1, massMax: 180, massOrig: 180 });
    await openRenovation(user);

    const width = await screen.findByLabelText("Width");
    await user.clear(width);
    await user.type(width, "6");

    await waitFor(() => {
      expect(view.container.textContent).toMatch(/not a refund/i);
    });
  });

  it("refuses a tonnage outside the envelope the complex was built at", async () => {
    const user = userEvent.setup();
    const { view } = mount(LC1);
    await openRenovation(user);

    const tonnage = await screen.findByLabelText("Tonnage limit");
    await user.clear(tonnage);
    await user.type(tonnage, "500");

    // RP-1's own bound, derived from massOrig: max(3, floor(x2)) above. The
    // figure is a `Unit` and so is its own node, hence the two assertions.
    const refusal = await screen.findByText(
      /Cannot upgrade tonnage above the limit of/,
    );
    expect(refusal).toBeInTheDocument();
    expect(refusal.textContent).toContain("200");
    expect(view.container).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Queue the renovation of LC-1" }),
    ).toBeDisabled();
  });

  it("says how many engineers the renovation takes off before the press", async () => {
    const user = userEvent.setup();
    const { view } = mount(LC1);
    await openRenovation(user);

    /*
     * Not a side effect this Uplink chose: RP-1 does ChangeEngineers(lc,
     * -lc.Engineers) as the first thing it does and pops a dialog saying so
     * AFTERWARDS. A console can say it while it can still change the answer.
     */
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/18 .*unassigned|unassign/i);
    });
  });

  it("draws neither tonnage nor human rating for the hangar, which RP-1 refuses both of", async () => {
    const user = userEvent.setup();
    mount({
      ...LC1,
      humanRated: true,
      lcType: "Hangar",
      massMax: undefined,
      massOrig: undefined,
      name: "Hangar",
    });

    await user.click(
      await screen.findByRole("button", { name: "Detail for Hangar" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Renovate Hangar" }),
    );

    /*
     * RP-1 draws neither field for the hangar, forces the rating true and holds
     * the limit where it is, and the command REFUSES either argument rather than
     * discarding it. A field drawn here could only produce a refusal.
     */
    await screen.findByLabelText("Width");
    expect(screen.queryByLabelText("Tonnage limit")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Human-rated" }),
    ).not.toBeInTheDocument();
  });
});
