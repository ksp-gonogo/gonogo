import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  parseEffectLines,
  parseStrategies,
  StrategiesComponent,
} from "./index";

const KEYS: DataKey[] = [
  { key: "strategies.all" },
  { key: "career.funds" },
  { key: "career.reputation" },
  { key: "career.science" },
  { key: "kc.scene" },
];

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
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;
  let actions: string[];

  beforeEach(async () => {
    actions = [];
    fixture = await setupMockDataSource({
      keys: KEYS,
      onExecute: (a) => {
        actions.push(a);
      },
    });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the active strategy with a deactivate confirmation flow", async () => {
    const user = userEvent.setup();
    render(<StrategiesComponent config={{}} id="s" />);
    act(() => {
      source.emit("strategies.all", [SAMPLE_ACTIVE, SAMPLE_BLOCKED]);
      source.emit("career.funds", 289848);
      source.emit("career.reputation", 976);
      source.emit("career.science", 0);
      source.emit("kc.scene", "SPACECENTER");
    });

    expect(screen.getByText("Aggressive Negotiations")).toBeInTheDocument();
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
    expect(
      actions.some((a) => a === "strategies.deactivate[AgressiveNegotiations]"),
    ).toBe(true);
  });

  it("groups soft-blocked strategies under Available with a hint", () => {
    render(<StrategiesComponent config={{}} id="s" />);
    act(() => {
      source.emit("strategies.all", [SAMPLE_ACTIVE, SAMPLE_BLOCKED]);
      source.emit("career.funds", 289848);
      source.emit("career.reputation", 976);
      source.emit("career.science", 0);
      source.emit("kc.scene", "SPACECENTER");
    });

    expect(
      screen.getByText(/Deactivate the running strategy first/i),
    ).toBeInTheDocument();
  });

  it("lists requirement-locked strategies in the Locked section", () => {
    render(<StrategiesComponent config={{}} id="s" />);
    act(() => {
      source.emit("strategies.all", [SAMPLE_ACTIVE, SAMPLE_LOCKED]);
      source.emit("career.funds", 289848);
      source.emit("career.reputation", 100);
      source.emit("career.science", 0);
      source.emit("kc.scene", "SPACECENTER");
    });

    const locked = screen.getByRole("region", { name: "Locked" });
    expect(within(locked).getByText("Patriotism Drive")).toBeInTheDocument();
    expect(
      within(locked).getByText(/Requires more reputation/i),
    ).toBeInTheDocument();
  });

  it("fires strategies.activate with the chosen factor", async () => {
    const user = userEvent.setup();
    const inactive = { ...SAMPLE_BLOCKED, canActivate: true };
    render(<StrategiesComponent config={{}} id="s" />);
    act(() => {
      source.emit("strategies.all", [inactive]);
      source.emit("career.funds", 289848);
      source.emit("career.reputation", 976);
      source.emit("career.science", 0);
      source.emit("kc.scene", "SPACECENTER");
    });

    await user.click(screen.getByRole("button", { name: /^Activate$/i }));
    await user.click(screen.getByRole("button", { name: /Confirm activate/i }));

    // Factor defaults to factorSliderDefault (0.05) for this fixture.
    expect(
      actions.some((a) =>
        a.startsWith("strategies.activate[FundraisingCampaignCfg,0.05"),
      ),
    ).toBe(true);
  });
});
