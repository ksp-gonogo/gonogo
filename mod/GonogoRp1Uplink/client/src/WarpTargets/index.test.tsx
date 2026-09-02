import {
  act,
  getAugmentsForSlot,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  RP1_FUND_TARGET_CANCEL_COMMAND,
  RP1_FUND_TARGET_SET_COMMAND,
} from "./FundTarget";
import {
  RP1_WARP_TO_COMPLETE_COMMAND,
  RP1_WARP_TO_FUND_TARGET_COMMAND,
  WarpTargets,
} from "./index";

const TOPICS = [
  "career.status",
  "rp1.available",
  "rp1.fundTarget",
  RP1_FUND_TARGET_CANCEL_COMMAND,
  RP1_FUND_TARGET_SET_COMMAND,
  RP1_WARP_TO_COMPLETE_COMMAND,
  RP1_WARP_TO_FUND_TARGET_COMMAND,
];

function mount(
  fundTarget?: Record<string, unknown>,
  funds: number | null = 120_000,
) {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <WarpTargets />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("rp1.available", true);
    if (funds !== null) {
      fixture.emit("career.status", { economy: { funds } });
    }
    if (fundTarget !== undefined) {
      fixture.emit("rp1.fundTarget", fundTarget);
    }
  });
  return { fixture, view };
}

describe("WarpTargets", () => {
  it("binds the slot the host widget already has for a mod's warp target", () => {
    /*
     * An augment rather than a widget, and the assertion is that it LANDS in the
     * slot rather than merely rendering: warping is one act with one piece of
     * state, and a second panel owning the mod's version would make an operator
     * hunt for whichever one RP-1 respects.
     */
    const augments = getAugmentsForSlot("warp-control.stepper");
    expect(augments.map((a) => a.id)).toContain("rp1-warp-targets");
  });

  it("renders nothing at all until RP-1 says it is there", async () => {
    const fixture = setupStreamFixture({ carriedChannels: TOPICS });
    const view = render(
      <fixture.Provider>
        <WarpTargets />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("rp1.available", false);
    });

    await waitFor(() => {
      expect(view.container.textContent).toBe("");
    });
  });

  it('names what it warps to rather than saying only "next"', async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount();

    await user.click(
      await screen.findByRole("button", {
        name: "Warp until RP-1's next project finishes",
      }),
    );

    const sent = fixture.transport.sentCommands.find(
      (c) => c.command === RP1_WARP_TO_COMPLETE_COMMAND,
    );
    // No arguments at all: RP-1 holds exactly one next-thing-to-finish, so a
    // command carrying an id would imply a roster that does not exist.
    expect(sent?.args).toEqual({});
    await expectNoA11yViolations(view.container);
  });

  it("darkens the fund-target press when no target is standing, and says nothing else", async () => {
    const { view } = mount({ active: false });

    const button = await screen.findByRole("button", {
      name: "No fund target is standing, so there is no balance to warp toward",
    });
    expect(button).toBeDisabled();
    /*
     * The subtitle is GONE and its absence is the assertion. The operator ruled
     * that funds "needs LESS", so the reason a press is dark lives in its
     * accessible name, where a screen reader still gets it and the panel spends
     * no space on it.
     */
    expect(view.container.textContent).not.toContain("no fund target set");
  });

  it("warps to the fund target, and the press says what it warps to", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount({ active: true, timeLeft: 864000 });

    // The label names the target, on the operator's ruling. "warp to funds" was
    // the earlier wording and said less.
    await user.click(
      await screen.findByRole("button", {
        name: "Warp until the balance reaches the fund target",
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_WARP_TO_FUND_TARGET_COMMAND,
      )?.args,
    ).toEqual({});
    expect(screen.getByText("fund target")).toBeInTheDocument();
    // No ETA line: the operator asked for less here, not more.
    expect(view.container.textContent).not.toContain("fund target in");
  });

  it("offers no way to stop warping, because the host widget already does", async () => {
    mount({ active: true, timeLeft: 864000 });

    await waitFor(() => {
      expect(screen.getByText(/next completion/)).toBeInTheDocument();
    });
    /*
     * RP-1's controller destroys itself the moment it sees a warp rate of zero,
     * so the host's own "1x" button ends an RP-1 warp. A second stop control
     * would be two buttons doing one thing with the operator left to guess which
     * one the mod respects.
     */
    expect(
      screen.queryByRole("button", { name: /[Ss]top/ }),
    ).not.toBeInTheDocument();
  });

  it("sets the target the dark press exists to warp toward", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount({ active: false });

    await user.click(
      await screen.findByRole("button", { name: "Set a fund target" }),
    );
    const field = await screen.findByLabelText("Target balance");
    await user.clear(field);
    await user.type(field, "250000");
    await user.click(
      await screen.findByRole("button", {
        name: "Warp toward a balance of 250,000 funds",
      }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_FUND_TARGET_SET_COMMAND,
      )?.args,
    ).toEqual({ targetFunds: 250_000 });
    await expectNoA11yViolations(view.container);
  });

  /*
   * The whole of the spend statement for this command, and it is that there
   * ISN'T one. A fund target is a stop condition on a warp: RP-1's
   * FundTargetProject.Clear touches no currency and the project itself only ever
   * ends a warp, so an affordability line here would invent a cost. What the
   * operator needs instead is the balance the target is measured against.
   */
  it("names the balance rather than a price, because a stop condition spends nothing", async () => {
    const user = userEvent.setup();
    const { view } = mount({ active: false }, 120_000);

    await user.click(
      await screen.findByRole("button", { name: "Set a fund target" }),
    );

    await waitFor(() => {
      expect(view.container.textContent).toContain("120,000");
    });
    expect(view.container.textContent).not.toMatch(/afford|cost|spend/i);
  });

  it("says nothing about a balance on a save that has no funding", async () => {
    const user = userEvent.setup();
    const { view } = mount({ active: false }, null);

    await user.click(
      await screen.findByRole("button", { name: "Set a fund target" }),
    );
    await screen.findByLabelText("Target balance");
    /*
     * Absent, not empty, and not a zero. A sandbox save has no funding at all,
     * so a "balance" row would report a figure the career does not have.
     */
    expect(view.container.textContent).not.toMatch(/balance now/i);
  });

  it("withdraws a standing target without opening the screen that set it", async () => {
    const user = userEvent.setup();
    const { fixture } = mount({
      active: true,
      targetFunds: 250_000,
      timeLeft: 864_000,
    });

    await user.click(
      await screen.findByRole("button", { name: "Cancel the fund target" }),
    );

    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_FUND_TARGET_CANCEL_COMMAND,
      )?.args,
    ).toEqual({});
  });

  it("offers no cancel while nothing is standing, because RP-1 refuses one", async () => {
    mount({ active: false });

    await screen.findByRole("button", { name: "Set a fund target" });
    /*
     * RP-1's own cancel asks IsValid first and refuses when nothing stands, so a
     * press offered here could only ever report a failure.
     */
    expect(
      screen.queryByRole("button", { name: "Cancel the fund target" }),
    ).not.toBeInTheDocument();
  });
});
