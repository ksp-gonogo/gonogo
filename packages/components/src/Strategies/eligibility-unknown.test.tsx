import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
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

  it("refuses Activate with the unread reason, not with a refusal it never got", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED]);

    // No word on whether activation is the game's own, so the command may refuse and the control stays dark.
    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeDisabled();
    expect(activate).toHaveAttribute("title", UNANSWERED_REASON);
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
 * game's own and belongs in Locked; a derived yes must never arm a spend,
 * because a yes nobody screened is not an answer.
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

  it("does NOT arm Activate on a derived yes, and says what stands in the way", async () => {
    // Even on a career whose activation is the game's own.
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [DERIVED_YES], { activationPatched: false });

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeDisabled();
    expect(activate.getAttribute("title")).toMatch(
      /Nobody screened this answer/,
    );
  });

  it("DOES arm Activate on the same yes once the game itself screened it", async () => {
    // The control for the test above: the only difference is who answered.
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [
      { ...DERIVED_YES, activateVerdictSource: "screened" },
    ]);

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeEnabled();
  });
});

/**
 * An unanswered strategy can still be committed where the career's activation
 * is the game's own, because the command re-runs the checks. The control arms
 * on an explicit `activationPatched: false` and nothing else.
 */
describe("Strategies committing a strategy the roster left unanswered", () => {
  it("arms Activate on an unanswered row when the career's activation is the game's own", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED], { activationPatched: false });

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeEnabled();
    expect(activate.getAttribute("title")).toMatch(/made when you confirm/);
  });

  it("keeps it dark when another mod has changed activation", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED], { activationPatched: true });

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeDisabled();
  });

  it("keeps it dark when whether activation was changed could not be read", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED], { activationPatched: null });

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeDisabled();
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

  it("still refuses an unanswered row the career cannot afford", async () => {
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [{ ...UNANSWERED, initialCostFunds: 5_000_000 }], {
      activationPatched: false,
    });

    const activate = await screen.findByRole("button", { name: "Activate" });
    expect(activate).toBeDisabled();
    expect(activate.getAttribute("title")).toMatch(/Insufficient/);
  });
});
