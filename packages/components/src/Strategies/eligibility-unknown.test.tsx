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
 * Eligibility is a THREE-valued reading and the widget has to draw all three.
 *
 * The career model publishes `canActivate` as a nullable flag on purpose: the
 * game answers the question only from inside the facility screen, and with that
 * screen shut nobody can answer it for any strategy on the roster. A null is
 * therefore an account of which screen is open, and a false is a judgement the
 * game made about the strategy. Collapsing the first into the second puts a
 * whole roster under a heading reading LOCKED while every card underneath says
 * the state is unknown, which is what a live career showed.
 *
 * So the assertions that earn this file are the ones separating the two: an
 * unanswered strategy must not be in the Locked list, must say in the
 * operator's view WHY it is unanswered, and must still show its price, because
 * the operator's next move is to open the facility and spend.
 */

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function newFixture() {
  return setupStreamFixture({
    carriedChannels: ["career.status"],
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
  "unknown: KSP answers this only while the Administration Building is open";

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

function emitCareer(fixture: StreamFixture, all: unknown[]): void {
  act(() => {
    fixture.emit("career.status", {
      economy: { funds: 289_848, reputation: 420, science: 145 },
      facilities: null,
      contracts: null,
      strategies: { active: [], all, activeCount: 0 },
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
    // Both spellings the wire can carry: an explicit null, and the field simply
    // not being written because the value behind it was absent.
    const { canActivate: _omitted, ...withoutTheField } = UNANSWERED;
    const parsed = parseStrategies([UNANSWERED, withoutTheField]);
    expect(parsed?.[0].canActivate).toBeNull();
    expect(parsed?.[1].canActivate).toBeNull();
  });
});

describe("Strategies with an eligibility it could not read", () => {
  it("puts a genuine refusal in Locked", async () => {
    // The control. Every assertion below would also pass on a widget that had
    // simply lost its Locked list.
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
    /*
     * The hero assertion, and the defect verbatim: an unread eligibility filed
     * beside the game's own refusals asserts a fact about the career that
     * nobody established.
     */
    const fixture = newFixture();
    renderStrategies(fixture);
    emitCareer(fixture, [UNANSWERED, REFUSED]);

    const locked = await screen.findByRole("region", { name: "Locked" });
    expect(within(locked).queryByText("Orbital Logistics")).toBeNull();
    expect(within(locked).getByText("Patriotism Drive")).toBeInTheDocument();
  });

  it("keeps an unanswered strategy out of Available too", async () => {
    // The opposite falsehood, and just as reachable: an unread eligibility is
    // not permission either.
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
    // The career model's own wording, on screen rather than in a tooltip: a
    // title attribute is invisible to a keyboard and to a glance.
    expect(within(unknown).getByText(UNANSWERED_REASON)).toBeInTheDocument();
    expect(visibleText()).not.toContain("Locked");
  });

  it("states one shared reason once rather than on all of them", async () => {
    // A closed facility makes every strategy unanswerable at once, so the
    // per-card spelling is the same sentence down the whole screen.
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
    // The card is a spend control the operator is about to be able to use. A
    // roster that hides what everything costs until the facility is open makes
    // them go and look, which is the errand the widget exists to save.
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

    // Disabled on purpose: the actuator refuses on exactly the same ground, so
    // an armed button here would promise a dispatch that cannot land.
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
