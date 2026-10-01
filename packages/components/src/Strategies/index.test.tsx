import { DashboardItemContext } from "@ksp-gonogo/core";
import { commandArgs } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { perItemGateReport } from "../test/perItemGate";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  parseEffectLines,
  parseStrategies,
  StrategiesComponent,
} from "./index";

function emitCareer(
  fixture: ReturnType<typeof setupStreamFixture>,
  all: unknown[],
  balances: { funds: number; reputation: number; science: number },
) {
  const active = all.filter((s) => activeFlag(s) === true);
  fixture.emit("career.status", {
    balances,
    facilities: null,
    contracts: null,
    strategies: { active, all, activeCount: active.length },
    tech: null,
  });
}

const SAMPLE_ACTIVE = {
  id: "AgressiveNegotiations",
  title: "Aggressive Negotiations",
  description: "Push harder on every deal.",
  departmentName: "Operations",
  isActive: true,
  factor: 0.05,
  dateActivated: 33246,
  requiredReputation: -10,
  initialCostFunds: 0,
  initialCostScience: 0,
  initialCostReputation: 14.5,
  effectiveCostReputation: 27.65,
  hasFactorSlider: true,
  factorSliderDefault: 0.05,
  factorSliderSteps: 20,
  canActivate: false,
  activateBlockedReason:
    "The Administration Facility cannot support more than 1 active strategies at this level",
  canDeactivate: true,
  deactivateBlockedReason: "",
  effect:
    "<b><color=#feb200>Effects: </color></b>\n<b><color=#BEC2AE>* -1.5% Funds Off on Launch Costs and R&D Purchases.</color></b>\n<b><color=#BEC2AE>* -0.05% Funds Off on Facility Repair and Construction.</color></b>\n\n",
};

const SAMPLE_BLOCKED = {
  id: "FundraisingCampaignCfg",
  title: "Fundraising Campaign",
  description: "Beg for money.",
  departmentName: "Finances",
  isActive: false,
  factor: 0.05,
  dateActivated: 0,
  requiredReputation: -437.5,
  initialCostFunds: 0,
  initialCostScience: 0,
  initialCostReputation: 7.3,
  effectiveCostReputation: 13.97,
  hasFactorSlider: true,
  factorSliderDefault: 0.05,
  factorSliderSteps: 20,
  canActivate: false,
  activateBlockedReason:
    "The Administration Facility cannot support more than 1 active strategies at this level",
  canDeactivate: false,
  deactivateBlockedReason: "Strategy is not active",
  effect:
    "<b><color=#feb200>Effects: </color></b>\n<b><color=#BEC2AE>* Takes 5% Reputation gains</color></b>\n\n<b><color=#EDED8B>Setup Cost:</color></b> 7\n",
};

const SAMPLE_LOCKED = {
  id: "PatriotismDriveCfg",
  title: "Patriotism Drive",
  description: "Wave the flag.",
  departmentName: "Public Relations",
  isActive: false,
  factor: 0.05,
  dateActivated: 0,
  requiredReputation: 750,
  initialCostFunds: 0,
  initialCostScience: 0,
  initialCostReputation: 0,
  effectiveCostReputation: 0,
  hasFactorSlider: false,
  factorSliderDefault: 0.05,
  factorSliderSteps: 1,
  canActivate: false,
  activateBlockedReason:
    "Requires more reputation than the program has earned.",
  canDeactivate: false,
  deactivateBlockedReason: "Strategy is not active",
  effect: "",
};

/** A strategy row's `isActive`, and `undefined` when the row does not carry one. */
function activeFlag(row: unknown): boolean | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const flag: unknown = Reflect.get(row, "isActive");
  return typeof flag === "boolean" ? flag : undefined;
}

describe("parseEffectLines", () => {
  it("strips KSP rich-text tags and emits bullet lines", () => {
    const lines = parseEffectLines(SAMPLE_ACTIVE.effect);
    expect(lines).toEqual([
      "-1.5% Funds Off on Launch Costs and R&D Purchases.",
      "-0.05% Funds Off on Facility Repair and Construction.",
    ]);
  });

  it("drops the trailing Setup Cost block", () => {
    const lines = parseEffectLines(SAMPLE_BLOCKED.effect);
    expect(lines).toEqual(["Takes 5% Reputation gains"]);
  });

  it("returns an empty list when no effect text", () => {
    expect(parseEffectLines("")).toEqual([]);
  });
});

describe("parseStrategies", () => {
  it("returns null for non-array input", () => {
    expect(parseStrategies(null)).toBeNull();
    expect(parseStrategies({})).toBeNull();
  });

  it("drops entries without an id", () => {
    const result = parseStrategies([{ title: "no id" }, SAMPLE_ACTIVE]);
    expect(result).toHaveLength(1);
    expect(result?.[0].id).toBe("AgressiveNegotiations");
  });

  it("falls back to nominal rep cost when effectiveCostReputation missing", () => {
    const { effectiveCostReputation: _unused, ...withoutEff } = SAMPLE_ACTIVE;
    const result = parseStrategies([withoutEff]);
    expect(result?.[0].effectiveCostReputation).toBe(14.5);
  });
});

describe("StrategiesComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "s" }}>
          <StrategiesComponent config={{}} id="s" />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("shows the active strategy with a deactivate confirmation flow", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitCareer(stream, [SAMPLE_ACTIVE, SAMPLE_BLOCKED], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });

    expect(
      await screen.findByText("Aggressive Negotiations"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/-1\.5% Funds Off on Launch Costs/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Deactivate$/i }));
    expect(
      screen.getByRole("button", { name: /Confirm deactivate/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Confirm deactivate/i }),
    );
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "career.strategy.deactivate",
      );
      expect(sent).toMatchObject({
        args: { strategyId: "AgressiveNegotiations" },
        vantage: "meta",
      });
    });
  });

  it("darkens Deactivate for the one strategy its gate refuses, with the game's reason", async () => {
    renderWidget();
    act(() => {
      emitCareer(stream, [{ ...SAMPLE_ACTIVE, canDeactivate: false }], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });
    // The roster's own canDeactivate decides nothing; the control is live until the gate says otherwise.
    expect(
      await screen.findByRole("button", { name: /^Deactivate$/i }),
    ).not.toHaveAttribute("aria-disabled");

    act(() => {
      stream.emit(
        "system.uplink.gates",
        perItemGateReport("career.strategy.deactivate", "strategyId", {
          AgressiveNegotiations: {
            errorCode: "wrongState",
            detail: "the minimum commitment has not elapsed",
          },
        }),
      );
    });
    expect(
      await screen.findByRole("button", {
        name: /minimum commitment has not elapsed/,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("groups soft-blocked strategies under Available with a hint", async () => {
    renderWidget();
    act(() => {
      emitCareer(stream, [SAMPLE_ACTIVE, SAMPLE_BLOCKED], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });

    expect(
      await screen.findByText(/Deactivate the running strategy first/i),
    ).toBeInTheDocument();
  });

  it("lists requirement-locked strategies in the Locked section", async () => {
    renderWidget();
    act(() => {
      emitCareer(stream, [SAMPLE_ACTIVE, SAMPLE_LOCKED], {
        funds: 289848,
        reputation: 100,
        science: 0,
      });
    });

    const locked = await screen.findByRole("region", { name: "Locked" });
    expect(within(locked).getByText("Patriotism Drive")).toBeInTheDocument();
    expect(
      within(locked).getByText(/Requires more reputation/i),
    ).toBeInTheDocument();
  });

  it("fires strategies.activate with the chosen factor", async () => {
    const user = userEvent.setup();
    const inactive = { ...SAMPLE_BLOCKED, canActivate: true };
    renderWidget();
    act(() => {
      emitCareer(stream, [inactive], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });

    await user.click(
      await screen.findByRole("button", { name: /^Activate$/i }),
    );
    await user.click(screen.getByRole("button", { name: /Confirm activate/i }));

    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "career.strategy.activate",
      );
      expect(sent?.command).toBe("career.strategy.activate");
      expect(sent?.vantage).toBe("meta");
      const args = commandArgs<"career.strategy.activate">(sent?.args);
      expect(args.strategyId).toBe("FundraisingCampaignCfg");
      expect(args.factor).toBeCloseTo(0.05, 2);
    });
  });

  it("keeps the activate button pending across a sample that has not flipped isActive", async () => {
    const user = userEvent.setup();
    const inactive = { ...SAMPLE_BLOCKED, canActivate: true };
    renderWidget();
    act(() => {
      emitCareer(stream, [inactive], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });

    // Held, so the pending state has something to mean.
    stream.transport.holdCommands();

    await user.click(
      await screen.findByRole("button", { name: /^Activate$/i }),
    );
    await user.click(screen.getByRole("button", { name: /Confirm activate/i }));

    expect(
      await screen.findByRole("button", { name: /Activating/i }),
    ).toBeInTheDocument();

    // A fresh sample with the same strategy still inactive: the command has not landed, so the control must not say it has.
    act(() => {
      emitCareer(stream, [{ ...inactive }], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });

    expect(
      screen.getByRole("button", { name: /Activating/i }),
    ).toBeInTheDocument();

    await act(async () => {
      stream.transport.answerHeldCommands();
    });
    expect(
      await screen.findByRole("button", { name: /^Activate$/i }),
    ).toBeInTheDocument();
  });

  // Long prose is cut; only the press reveals it.
  it("cuts a long strategy description down and reveals it on press", async () => {
    const user = userEvent.setup();
    const long = [
      SAMPLE_ACTIVE.description,
      ...Array(6).fill(
        "Deals are struck over months of correspondence and a great deal of travel.",
      ),
    ].join(" ");
    renderWidget();
    act(() => {
      emitCareer(stream, [{ ...SAMPLE_ACTIVE, description: long }], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });

    await screen.findByText("Aggressive Negotiations");
    expect(screen.queryByText(long)).toBeNull();

    const more = screen.getByRole("button", {
      name: "Show more of Aggressive Negotiations",
    });
    await user.click(more);

    // Verbatim, once asked for: the cut hides text, it never edits it.
    expect(screen.getByText(long)).toBeInTheDocument();
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("leaves a one-line strategy description alone, control and all", async () => {
    renderWidget();
    act(() => {
      emitCareer(stream, [SAMPLE_ACTIVE], {
        funds: 289848,
        reputation: 976,
        science: 0,
      });
    });

    expect(
      await screen.findByText("Push harder on every deal."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show more/ })).toBeNull();
  });
});
