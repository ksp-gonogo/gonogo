import {
  act,
  clearRequestedAlarms,
  getAugmentsForSlot,
  getRequestedAlarms,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { RP1_FUND_TARGET_CANCEL_COMMAND } from "./FundTarget";
import { RP1_WARP_TO_COMPLETE_COMMAND, WarpTargets } from "./index";

const TOPICS = [
  "career.status",
  "rp1.available",
  "rp1.fundTarget",
  RP1_FUND_TARGET_CANCEL_COMMAND,
  RP1_WARP_TO_COMPLETE_COMMAND,
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

/** Open the balance-alarm panel and type a figure into it. */
async function typeTarget(user: ReturnType<typeof userEvent.setup>, n: string) {
  await user.click(
    await screen.findByRole("button", {
      name: "Set an alarm on the career balance",
    }),
  );
  const field = await screen.findByLabelText("Target balance");
  await user.clear(field);
  await user.type(field, n);
}

describe("WarpTargets", () => {
  beforeEach(() => {
    clearRequestedAlarms();
  });

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

  /*
   * The whole of the operator's ruling, in one assertion: RP-1 asks the APP for
   * an alarm and drives no warp of its own. The two commands that used to do this
   * (rp1.fundTarget.set to aim it, rp1.warp.toFundTarget to go) were one
   * controller wearing two names, and both are deleted.
   */
  it("asks the app for an alarm on the balance instead of driving a warp", async () => {
    const user = userEvent.setup();
    const { fixture, view } = mount({ active: false });

    await typeTarget(user, "250000");
    await user.click(
      await screen.findByRole("button", {
        name: "Stop the warp when the balance reaches 250,000 funds",
      }),
    );

    expect(getRequestedAlarms()).toEqual([
      {
        uplinkId: "rp1",
        key: "fund-target",
        name: "Balance reaches 250,000 funds",
        trigger: {
          kind: "threshold",
          topic: "career.status",
          fieldPath: "economy.funds",
          op: ">=",
          value: 250_000,
          /*
           * The craft's own clock: the simulation halts the warp on the tick the
           * balance is reached, which is the stop the deleted command gave and
           * the one a ground-side watch cannot.
           */
          vantage: "scet",
        },
      },
    ]);
    // Nothing went to RP-1. Not merely "no warp command": the press reaches no
    // mod at all.
    expect(fixture.transport.sentCommands).toEqual([]);
    await expectNoA11yViolations(view.container);
  });

  it("retargets one alarm rather than piling them up when pressed twice", async () => {
    const user = userEvent.setup();
    mount({ active: false });

    await typeTarget(user, "250000");
    await user.click(
      await screen.findByRole("button", {
        name: "Stop the warp when the balance reaches 250,000 funds",
      }),
    );
    await user.clear(await screen.findByLabelText("Target balance"));
    await user.type(await screen.findByLabelText("Target balance"), "400000");
    await user.click(
      await screen.findByRole("button", {
        name: "Stop the warp when the balance reaches 400,000 funds",
      }),
    );

    /*
     * Two requests under ONE key. The app retargets the alarm it already holds
     * under that key rather than adding a second, so an operator revising a
     * figure is left with one row.
     */
    expect(getRequestedAlarms().map((a) => a.key)).toEqual([
      "fund-target",
      "fund-target",
    ]);
  });

  it("seeds the figure from a target RP-1 is already holding", async () => {
    const user = userEvent.setup();
    mount({ active: true, targetFunds: 250_000, timeLeft: 864_000 });

    await user.click(
      await screen.findByRole("button", {
        name: "Set an alarm on the career balance",
      }),
    );

    /*
     * That figure is literally the threshold RP-1 is working toward, so arming on
     * it is a press rather than a retype. It can only get there through RP-1's
     * own Maintenance screen now, which is exactly why the input is still there
     * to be typed into.
     */
    await screen.findByRole("button", {
      name: "Stop the warp when the balance reaches 250,000 funds",
    });
  });

  it("darkens the press until there is a figure to arm on", async () => {
    const user = userEvent.setup();
    mount({ active: false });

    await user.click(
      await screen.findByRole("button", {
        name: "Set an alarm on the career balance",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Stop the warp when the balance reaches 0 funds",
      }),
    ).toBeDisabled();
  });

  /*
   * The whole of the spend statement for this control, and it is that there
   * ISN'T one. A balance alarm is a stop condition: RP-1's FundTargetProject
   * returns project type None, its IncrementProgress returns zero and its Clear
   * touches no currency, so an affordability line here would invent a cost. What
   * the operator needs instead is the balance the alarm is measured against.
   */
  it("names the balance rather than a price, because a stop condition spends nothing", async () => {
    const user = userEvent.setup();
    const { view } = mount({ active: false }, 120_000);

    await user.click(
      await screen.findByRole("button", {
        name: "Set an alarm on the career balance",
      }),
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
      await screen.findByRole("button", {
        name: "Set an alarm on the career balance",
      }),
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

    /*
     * The cancel SURVIVED the two deletions, and it is not the other half of
     * anything: RP-1's own Maintenance screen still stands targets up, and
     * withdrawing one from the dashboard beats going back for that screen.
     */
    expect(
      fixture.transport.sentCommands.find(
        (c) => c.command === RP1_FUND_TARGET_CANCEL_COMMAND,
      )?.args,
    ).toEqual({});
  });

  it("offers no cancel while nothing is standing, because RP-1 refuses one", async () => {
    mount({ active: false });

    await screen.findByRole("button", {
      name: "Set an alarm on the career balance",
    });
    /*
     * RP-1's own cancel asks IsValid first and refuses when nothing stands, so a
     * press offered here could only ever report a failure.
     */
    expect(
      screen.queryByRole("button", { name: "Cancel the fund target" }),
    ).not.toBeInTheDocument();
  });
});
