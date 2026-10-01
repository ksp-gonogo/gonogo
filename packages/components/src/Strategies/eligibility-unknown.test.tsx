import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { perItemGateReport } from "../test/perItemGate";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { parseStrategies, StrategiesComponent } from "./index";

/**
 * Eligibility is three-valued and the widget draws all three. A null
 * `canActivate` is a question nobody could put, not a refusal: an unanswered
 * strategy stays out of Locked, says why on screen, and still shows its price.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderStrategies(fixture: StreamFixture) {
  const result = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "strat-unknown" }}>
        <StrategiesComponent config={{}} id="strat-unknown" w={9} h={12} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

/** Verbatim what the career model publishes beside a null eligibility. */
const UNANSWERED_REASON =
  "unknown: this career's strategy limits could not be read";

/** Eligibility could not be read at all. Not a refusal. */
const UNANSWERED = {
  id: "Unanswered",
  title: "Orbital Logistics",
  description: "A programme nobody has been able to judge.",
  department: "Operations",
  isActive: false,
  initialCostFunds: 12_500,
  initialCostScience: 0,
  initialCostReputation: 0,
  canActivate: null,
  activateBlockedReason: UNANSWERED_REASON,
  canDeactivate: false,
  effect: "Effects: freight.",
};

/** The game judged this one and said no. This is what Locked is for. */
const REFUSED = {
  id: "Refused",
  title: "Patriotism Drive",
  description: "Wave the flag.",
  department: "Public Relations",
  isActive: false,
  initialCostFunds: 0,
  initialCostScience: 0,
  initialCostReputation: 0,
  canActivate: false,
  activateBlockedReason:
    "Requires more reputation than the program has earned.",
  canDeactivate: false,
  effect: "",
};

/** The mod's per-strategy activation gate refusing one strategy, as `system.uplink.gates` publishes it. */
function refuseActivation(
  fixture: StreamFixture,
  strategyId: string,
  detail: string,
): void {
  act(() => {
    fixture.emit(
      "system.uplink.gates",
      perItemGateReport("career.strategy.activate", "strategyId", {
        [strategyId]: { errorCode: "wrongState", detail },
      }),
    );
  });
}

function emitCareer(
  fixture: StreamFixture,
  all: unknown[],
  roster: { activationPatched?: boolean | null } = {},
): void {
  act(() => {
    fixture.emit("career.status", {
      balances: { funds: 289_848, reputation: 420, science: 145 },
      facilities: null,
      contracts: null,
      strategies: { active: [], all, activeCount: 0, ...roster },
      tech: null,
    });
  });
}

describe("parseStrategies carries the third eligibility state", () => {
  it("keeps a real answer as the boolean it is", () => {
    const parsed = parseStrategies([
      REFUSED,
      { ...REFUSED, canActivate: true },
    ]);
    expect(parsed?.[0].canActivate).toBe(false);
    expect(parsed?.[1].canActivate).toBe(true);
  });

  it("reads an unanswerable eligibility as null, not as a refusal", () => {
    // Both spellings the wire can carry: an explicit null and an absent field.
    const { canActivate: _omitted, ...withoutTheField } = UNANSWERED;
    const parsed = parseStrategies([UNANSWERED, withoutTheField]);
    expect(parsed?.[0].canActivate).toBeNull();
    expect(parsed?.[1].canActivate).toBeNull();
  });
});

describe("Strategies with an eligibility it could not read", () => {
  it("puts a genuine refusal in Locked", async () => {
    // The control: the assertions below would also pass on a widget with no Locked list.
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [REFUSED]);

    const locked = await screen.findByRole("region", { name: "Locked" });
    expect(within(locked).getByText("Patriotism Drive")).toBeInTheDocument();
    expect(
      within(locked).getByText(/Requires more reputation/i),
    ).toBeInTheDocument();
  });

  it("keeps an unanswered strategy OUT of Locked", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED, REFUSED]);

    const locked = await screen.findByRole("region", { name: "Locked" });
    expect(within(locked).queryByText("Orbital Logistics")).toBeNull();
    expect(within(locked).getByText("Patriotism Drive")).toBeInTheDocument();
  });

  it("keeps an unanswered strategy out of Available too", async () => {
    // An unread eligibility is not permission either.
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED]);

    const available = await screen.findByRole("region", { name: "Available" });
    expect(within(available).queryByText("Orbital Logistics")).toBeNull();
  });

  it("gives it a list of its own and says why in the operator's view", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED]);

    const unknown = await screen.findByRole("region", {
      name: "Eligibility unknown",
    });
    expect(within(unknown).getByText("Orbital Logistics")).toBeInTheDocument();
    // On screen rather than in a tooltip, which is invisible to a keyboard and to a glance.
    expect(within(unknown).getByText(UNANSWERED_REASON)).toBeInTheDocument();
    expect(visibleText()).not.toContain("Locked");
  });

  it("states one shared reason once rather than on all of them", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [
      UNANSWERED,
      { ...UNANSWERED, id: "Second", title: "Deep Space Relay" },
    ]);

    const unknown = await screen.findByRole("region", {
      name: "Eligibility unknown",
    });
    expect(within(unknown).getByText("Deep Space Relay")).toBeInTheDocument();
    expect(within(unknown).getAllByText(UNANSWERED_REASON)).toHaveLength(1);
  });

  it("names each reason when they differ", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [
      UNANSWERED,
      {
        ...UNANSWERED,
        id: "Threw",
        title: "Deep Space Relay",
        activateBlockedReason:
          "eligibility check failed: NullReferenceException",
      },
    ]);

    const unknown = await screen.findByRole("region", {
      name: "Eligibility unknown",
    });
    expect(within(unknown).getByText(UNANSWERED_REASON)).toBeInTheDocument();
    expect(
      within(unknown).getByText(/eligibility check failed/),
    ).toBeInTheDocument();
  });

  it("still shows the price, because opening the facility is the next move", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED]);

    const unknown = await screen.findByRole("region", {
      name: "Eligibility unknown",
    });
    expect(within(unknown).getByText(/12,500/)).toBeInTheDocument();
  });

  it("leaves Activate to the strategy's gate rather than refusing on a verdict it never got", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED]);

    // The unread reason is on screen in the list; the control itself is the command's to decide.
    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeEnabled();
    expect(activate).not.toHaveAttribute("aria-disabled");
  });

  it("has no accessibility violations with all three lists on screen", async () => {
    const fixture = newFixture();
    const { container } = renderStrategies(fixture);
    emitCareer(fixture, [
      UNANSWERED,
      REFUSED,
      { ...REFUSED, id: "Open", title: "Open Door Policy", canActivate: true },
    ]);
    await waitFor(() => expect(visibleText()).toContain("Eligibility unknown"));

    await expectNoA11yViolations(container);
  });
});

/**
 * A verdict is a pair: the answer, and who gave it. A derived refusal is the
 * game's own and belongs in Locked. Whether Activate is available is never the
 * roster's to say: the command's per-strategy gate runs the same checks the
 * command would, by the same route.
 */
describe("Strategies with a verdict derived off-screen", () => {
  /** A pair our career model never sends, but the published type admits it. */
  const DERIVED_YES = {
    ...REFUSED,
    id: "DerivedYes",
    title: "Open Door Policy",
    canActivate: true,
    activateBlockedReason: "",
    activateVerdictSource: "derived",
  };

  /** The game's own rule, quoted from off-screen. */
  const DERIVED_NO = {
    ...REFUSED,
    id: "DerivedNo",
    title: "Patriotism Drive",
    canActivate: false,
    activateBlockedReason: "You cannot afford this strategy.",
    activateVerdictSource: "derived",
  };

  it("reads the source off the wire, defaulting to screened when absent", () => {
    const parsed = parseStrategies([DERIVED_YES, REFUSED]);
    expect(parsed?.[0].activateVerdictSource).toBe("derived");
    expect(parsed?.[1].activateVerdictSource).toBe("screened");
  });

  it("files a derived refusal in Locked, with the game's own reason", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [DERIVED_NO]);

    const locked = await screen.findByRole("region", { name: "Locked" });
    expect(within(locked).getByText("Patriotism Drive")).toBeInTheDocument();
    expect(
      within(locked).getByText("You cannot afford this strategy."),
    ).toBeInTheDocument();
    expect(visibleText()).not.toContain("Eligibility unknown");
  });

  it("shows a derived yes as Available, if one ever arrives", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [DERIVED_YES]);

    const available = await screen.findByRole("region", { name: "Available" });
    expect(within(available).getByText("Open Door Policy")).toBeInTheDocument();
  });

  it("draws Activate from the strategy's gate whoever answered the roster", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [DERIVED_YES]);

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeEnabled();

    refuseActivation(fixture, "DerivedYes", "the strategy is not eligible");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /not eligible/ }),
      ).toHaveAttribute("aria-disabled", "true"),
    );
  });
});

/**
 * An unanswered strategy can still be committed where the command can run its
 * own checks. Where it cannot (another mod has replaced activation, and the
 * Administration Building is shut), the mod's per-strategy gate says so in
 * advance, and that is the only thing that darkens the control.
 */
describe("Strategies committing a strategy the roster left unanswered", () => {
  it("says the unread checks are made at confirm only where activation is the game's own", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED], { activationPatched: false });

    const unknown = await screen.findByRole("region", {
      name: "Eligibility unknown",
    });
    expect(
      within(unknown).getByText(/made when you confirm/),
    ).toBeInTheDocument();

    emitCareer(fixture, [UNANSWERED], { activationPatched: true });
    await waitFor(() =>
      expect(within(unknown).queryByText(/made when you confirm/)).toBeNull(),
    );
  });

  it("leaves Activate live while the strategy's gate says nothing", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED], { activationPatched: true });

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeEnabled();
  });

  it("darkens it, with the mod's reason, when the gate refuses that strategy", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED], { activationPatched: true });
    refuseActivation(
      fixture,
      "Unanswered",
      "another mod changes how a strategy activates",
    );

    const activate = await screen.findByRole("button", {
      name: /another mod changes how a strategy activates/,
    });
    expect(activate).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps a derived refusal dark whatever the roster says", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(
      fixture,
      [
        {
          ...UNANSWERED,
          canActivate: false,
          activateBlockedReason: "Not enough Funds to set up this Strategy",
          activateVerdictSource: "derived",
        },
      ],
      { activationPatched: false },
    );

    const locked = await screen.findByRole("region", { name: "Locked" });
    expect(within(locked).getByText("Orbital Logistics")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
  });

  it("marks the price short on a row the career cannot afford, and leaves the factor's cost to the command", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [{ ...UNANSWERED, initialCostFunds: 5_000_000 }], {
      activationPatched: false,
    });

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeEnabled();
    expect(
      document.querySelector("[data-afford]")?.getAttribute("data-afford"),
    ).toBe("no");
  });
});
