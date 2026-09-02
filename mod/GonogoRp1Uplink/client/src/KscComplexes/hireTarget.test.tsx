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
import {
  RP1_HIRE_TARGET_CANCEL_COMMAND,
  RP1_HIRE_TARGET_SET_COMMAND,
} from "./HireTarget";
import { KscComplexes } from "./index";

const TOPICS = [
  "career.status",
  "rp1.available",
  "rp1.centres",
  "rp1.complexes",
  "rp1.pads",
  "rp1.personnel",
  RP1_HIRE_TARGET_CANCEL_COMMAND,
  RP1_HIRE_TARGET_SET_COMMAND,
];

const CAPE = {
  anyOperational: true,
  engineers: 30,
  isActive: true,
  kscName: "Cape",
  launchComplexCount: 1,
  unassignedEngineers: 6,
};

const COMPLEXES = [
  {
    engineers: 18,
    isOperational: true,
    kscName: "Cape",
    lcId: "lc-1",
    lcType: "Pad",
    maxEngineers: 60,
    name: "LC-1",
  },
];

function mount(
  personnel: Record<string, unknown>,
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
    fixture.emit("rp1.complexes", COMPLEXES);
    fixture.emit("rp1.pads", []);
    fixture.emit("rp1.personnel", personnel);
    if (funds !== null) {
      fixture.emit("career.status", { economy: { funds } });
    }
  });
  return { fixture, view };
}

const IDLE = {
  applicants: 7,
  researchers: 31,
  totalEngineers: 30,
  hireTarget: { active: false },
};

describe("the standing hire instruction", () => {
  it("stands one up for researchers, with the reserve it will not spend below", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount(IDLE);

    await user.click(
      await screen.findByRole("button", { name: "Set a hire target" }),
    );
    const headcount = await screen.findByLabelText("Target headcount");
    await user.clear(headcount);
    await user.type(headcount, "40");
    const reserve = await screen.findByLabelText("Reserve");
    await user.clear(reserve);
    await user.type(reserve, "20000");
    // Armed, then confirmed: this commits the career to a standing spend, which
    // is the case the arm exists for.
    await user.click(
      await screen.findByRole("button", {
        name: "Hire up to 40 researchers, spending no lower than 20,000 funds",
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Confirm hiring up to 40 researchers",
      }),
    );

    /*
     * No `lcId`, and its absence IS the kind: RP-1 stores no field saying
     * whether an instruction hires researchers or engineers, only whether a
     * complex is named.
     */
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_HIRE_TARGET_SET_COMMAND,
      )?.args,
    ).toEqual({ reserveFunds: 20_000, targetCount: 40 });
    await expectNoA11yViolations(view.container);
  });

  it("names the complex when the target hires engineers", async () => {
    const user = userEvent.setup();
    const { fixture } = mount(IDLE);

    await user.click(
      await screen.findByRole("button", { name: "Set a hire target" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Hire engineers at LC-1" }),
    );
    const headcount = await screen.findByLabelText("Target headcount");
    await user.clear(headcount);
    await user.type(headcount, "25");

    await user.click(
      await screen.findByRole("button", {
        name: "Hire up to 25 engineers at LC-1, spending no lower than 0 funds",
      }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Confirm hiring up to 25 engineers at LC-1",
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_HIRE_TARGET_SET_COMMAND,
      )?.args,
    ).toEqual({ lcId: "lc-1", reserveFunds: 0, targetCount: 25 });
  });

  /*
   * The spend statement, and the thing this control most has to get right.
   * HireStaffProject.IncrementProgress hires
   * min(applicants + (funds - reserve) / perHire, left) every tick, so nothing
   * is charged at the press and a short balance SLOWS the instruction instead
   * of refusing it. The bound is exact and it is the operator's own reserve, so
   * that is what the line states.
   */
  it("states the bound on the spend rather than an affordability verdict", async () => {
    const user = userEvent.setup();
    const { view } = mount(IDLE, 120_000);

    await user.click(
      await screen.findByRole("button", { name: "Set a hire target" }),
    );
    const reserve = await screen.findByLabelText("Reserve");
    await user.clear(reserve);
    await user.type(reserve, "20000");

    await waitFor(() => {
      expect(view.container.textContent).toContain("100,000");
    });
    expect(view.container.textContent).not.toMatch(
      /cannot afford|too expensive/i,
    );
  });

  it("refuses a target at or below the count it is measured against, in RP-1's words", async () => {
    const user = userEvent.setup();
    mount(IDLE);

    await user.click(
      await screen.findByRole("button", { name: "Set a hire target" }),
    );
    const headcount = await screen.findByLabelText("Target headcount");
    await user.clear(headcount);
    await user.type(headcount, "31");

    // RP-1's own arm, and it is the one with words rather than a silent clamp.
    expect(
      await screen.findByText(
        "Staff count must be greater than the existing amount!",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Hire up to 31 researchers, spending no lower than 0 funds",
      }),
    ).toBeDisabled();
  });

  it("reports what stands, and withdraws it in one press", async () => {
    const user = userEvent.setup();
    const { fixture } = mount({
      ...IDLE,
      hireTarget: {
        active: true,
        currentCount: 31,
        isResearch: true,
        leftToHire: 9,
        targetCount: 40,
        timeLeft: 864_000,
      },
    });

    expect(await screen.findByText(/9/)).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "Cancel the hire target" }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_HIRE_TARGET_CANCEL_COMMAND,
      )?.args,
    ).toEqual({});
    /*
     * One instruction per career, so the form is not drawn beside what it would
     * replace: RP-1 keeps a single `staffTarget` and setting a second silently
     * discards the first.
     */
    expect(
      screen.queryByRole("button", { name: "Set a hire target" }),
    ).not.toBeInTheDocument();
  });

  it("is absent on a save with no funding rather than drawn against a zero", async () => {
    const { view } = mount(IDLE, null);

    await waitFor(() => {
      expect(screen.getByText("PAYROLL")).toBeInTheDocument();
    });
    /*
     * Hiring is a funds mechanic bounded by a funds reserve. A save with no
     * funding has neither, so the control is not there at all: an empty reserve
     * field would ask the operator to bound a spend that cannot happen.
     */
    expect(
      screen.queryByRole("button", { name: "Set a hire target" }),
    ).not.toBeInTheDocument();
    expect(view.container.textContent).not.toContain("Reserve");
  });
});
