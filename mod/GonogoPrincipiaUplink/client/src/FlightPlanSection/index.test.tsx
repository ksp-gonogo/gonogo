import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { FlightPlanSection } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

/** The instant every fixture pins the view clock to. */
const VIEW_UT = 10_000;

const CARRIED = ["principia.flightPlan", "vessel.identity"];

function mount(pinnedUt = VIEW_UT) {
  const stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt });
  const result = render(
    <stream.Provider>
      <FlightPlanSection />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

/**
 * A plan observed AT the pinned view instant, which is the fresh case.
 *
 * `validAt` is stated rather than defaulted: the transport's own default is 0,
 * so an emit with no meta lands 10,000 seconds behind a clock pinned at
 * `VIEW_UT` and every test would silently be exercising the stale path. That is
 * how the fresh/stale pair below came to disagree, and stating it here is why
 * each test now says which one it means.
 *
 * `StubTransport.emit` only delivers to something that actually subscribed, so
 * an emit inside `act` is also the proof that the widget's own read subscribed
 * rather than reading a store the test filled behind its back.
 */
function emitPlan(
  stream: ReturnType<typeof mount>,
  overrides: Record<string, unknown> = {},
) {
  act(() => {
    stream.emit("principia.flightPlan", plan(overrides), { validAt: VIEW_UT });
  });
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    vesselId: "vessel-1",
    observedAtUt: VIEW_UT,
    planExists: true,
    reachedDeadline: false,
    planIntegrated: true,
    anomalousBurnCount: 0,
    firstFutureBurnIndex: 0,
    burns: [
      {
        index: 0,
        ignitionUt: VIEW_UT + 600,
        cutoffUt: VIEW_UT + 660,
        durationSeconds: 60,
        deltaV: 120.5,
        anomalous: false,
      },
    ],
    ...overrides,
  };
}

describe("FlightPlanSection: an observation, dated", () => {
  /**
   * The one that matters most. With no sample at all the widget must say the
   * plan has NOT BEEN OBSERVED, never that there is no plan: the producer can
   * only read the plan while the game's own planner window is drawing it, so
   * silence means nobody has looked. An operator told "no flight plan" for a
   * vessel that has one stops looking, and that is the failure that kills a
   * mission.
   */
  it("says the plan is unobserved, not absent, before any sample arrives", () => {
    mount();

    expect(screen.getByText("PLAN NOT OBSERVED")).toBeInTheDocument();
    expect(screen.queryByText(/No flight plan/i)).not.toBeInTheDocument();
  });

  /**
   * And the complement, which is what makes the test above non-vacuous: an
   * OBSERVED absence is stated plainly. Two different sentences for two
   * different facts, and this pins that they cannot collapse into one.
   */
  it("states a positively observed absence as no flight plan", async () => {
    const stream = mount();

    emitPlan(stream, { planExists: false, burns: [] });

    expect(await screen.findByText(/No flight plan/i)).toBeInTheDocument();
    expect(screen.queryByText("PLAN NOT OBSERVED")).not.toBeInTheDocument();
  });

  /**
   * Asserts the NUMBERS, not just the row label and the badge.
   *
   * The first version of this checked `#1` and `NEXT` and passed while BOTH
   * quantity columns rendered a null dash: the nested burn type's units were
   * never registered, so Δv and duration arrived bare and `<Unit>` had nothing
   * to format. A render is what showed the empty columns. A test that names a
   * label proves the row exists; only one that names a value proves the row says
   * anything.
   */
  it("renders a burn row with its quantities, not just its label", async () => {
    const stream = mount();

    emitPlan(stream);

    expect(await screen.findByText("#1")).toBeInTheDocument();
    expect(screen.getByText("NEXT")).toBeInTheDocument();
    // The Δv WITH ITS UNIT, because the unit is the half that was missing: the
    // nested type's units were unregistered, so the value arrived bare and
    // `<Unit>` rendered a null dash. `121` is 120.5 at zero decimals.
    const text = visibleText(stream.container);
    expect(text).toContain("121 m/s");
    expect(text).not.toContain(NULL_DISPLAY);
  });

  /**
   * Both indices have to be readable before they can agree. Written because the
   * first version compared the two funnelled magnitudes and a payload missing
   * BOTH would have `null === null` mark every row NEXT: a confident wrong
   * answer on every line, from a field going missing.
   */
  it("marks no burn as next when the index cannot be read", async () => {
    const stream = mount();

    emitPlan(stream, {
      firstFutureBurnIndex: null,
      burns: [
        { index: null, ignitionUt: VIEW_UT + 60, deltaV: 5 },
        { index: null, ignitionUt: VIEW_UT + 120, deltaV: 5 },
      ],
    });

    expect(await screen.findByText("INTEGRATED")).toBeInTheDocument();
    expect(screen.queryByText("NEXT")).not.toBeInTheDocument();
  });

  /**
   * The headline behaviour. A plan observed in the past is SHOWN, dated, rather
   * than withheld: an operator who can see the plan is six hours old can act on
   * it, where one shown nothing concludes there is nothing. And the ignition
   * countdown is measured from the VIEW instant, so a burn four minutes after a
   * six-hour-old snapshot reads as long past rather than as imminent.
   */
  it("falls back to the sample instant when the plan does not state its own", async () => {
    const stream = mount();

    // `observedAtUt` deliberately absent: this is the fallback path, for a
    // producer that carried a plan without saying when it looked. The sample's
    // own UT is then the best available answer and is used as one.
    act(() => {
      stream.emit("principia.flightPlan", plan({ observedAtUt: undefined }), {
        validAt: VIEW_UT - 3_600,
      });
    });

    expect(await screen.findByText("#1")).toBeInTheDocument();
    expect(screen.queryByText("OBSERVED NOW")).not.toBeInTheDocument();
    expect(visibleText(stream.container)).toMatch(/OBSERVED .* AGO/);
  });

  /**
   * The complement, and what makes the test above mean something: a plan
   * observed at the view instant says so. Without this pair, a widget that
   * always printed an age would pass every other test in this file.
   */
  /**
   * The payload's own instant is what is shown, not the sample's, and they are
   * made to DISAGREE here on purpose. A render fixture that set only the payload
   * field produced a byte-identical image to the fresh one, which is how the two
   * were found to be different facts: the sample UT is transport metadata and the
   * payload field is the producer's claim about when it looked.
   */
  it("prefers the plan's own observation instant over the sample's", async () => {
    const stream = mount();

    act(() => {
      stream.emit(
        "principia.flightPlan",
        plan({ observedAtUt: VIEW_UT - 3_600 }),
        { validAt: VIEW_UT },
      );
    });

    expect(await screen.findByText("#1")).toBeInTheDocument();
    expect(visibleText(stream.container)).toMatch(/OBSERVED .* AGO/);
    expect(screen.queryByText("OBSERVED NOW")).not.toBeInTheDocument();
  });

  it("says a plan observed at the view instant is current", async () => {
    const stream = mount();

    emitPlan(stream);

    expect(await screen.findByText("OBSERVED NOW")).toBeInTheDocument();
    expect(visibleText(stream.container)).not.toMatch(/AGO/);
  });

  it("marks the burn the integrator flagged", async () => {
    const stream = mount();

    emitPlan(stream, {
      anomalousBurnCount: 1,
      burns: [
        {
          index: 0,
          ignitionUt: VIEW_UT + 600,
          durationSeconds: 60,
          deltaV: 10,
          anomalous: true,
        },
      ],
    });

    expect(await screen.findByText("ANOM")).toBeInTheDocument();
  });

  /**
   * Three states, three sentences. A failed integration names the burn, because
   * "the plan failed" and "burn 2 failed" ask different things of an operator,
   * and an UNKNOWN status is its own row rather than being rounded to either
   * answer.
   */
  it("names the burn that broke the integration", async () => {
    const stream = mount();

    emitPlan(stream, { planIntegrated: false, firstErrorBurnIndex: 1 });

    expect(
      await screen.findByText("INTEGRATION FAILED AT BURN 2"),
    ).toBeInTheDocument();
  });

  it("keeps an unreadable integration status as unknown rather than rounding it", async () => {
    const stream = mount();

    emitPlan(stream, { planIntegrated: null });

    expect(
      await screen.findByText("INTEGRATION STATUS UNKNOWN"),
    ).toBeInTheDocument();
    expect(screen.queryByText("INTEGRATED")).not.toBeInTheDocument();
  });

  it("says a plan is incomplete when the integrator ran out of time", async () => {
    const stream = mount();

    emitPlan(stream, { reachedDeadline: true });

    expect(await screen.findByText("PLAN INCOMPLETE")).toBeInTheDocument();
  });

  /**
   * The attribution guard. The planner draws for its own predicted vessel, which
   * is not always the active one, so a plan whose guid disagrees is never
   * presented as this vessel's without saying so.
   */
  it("says so when the plan belongs to another vessel", async () => {
    const stream = mount();

    act(() => {
      stream.emit("vessel.identity", {
        vesselId: "vessel-2",
        name: "Other",
        vesselType: 0,
        situation: 0,
      });
    });
    emitPlan(stream, { vesselId: "vessel-1" });

    expect(
      await screen.findByText(/belongs to another vessel/i),
    ).toBeInTheDocument();
  });

  it("stays quiet about attribution when the guids agree", async () => {
    const stream = mount();

    act(() => {
      stream.emit("vessel.identity", {
        vesselId: "vessel-1",
        name: "Ours",
        vesselType: 0,
        situation: 0,
      });
    });
    emitPlan(stream, { vesselId: "vessel-1" });

    expect(await screen.findByText("#1")).toBeInTheDocument();
    expect(
      screen.queryByText(/belongs to another vessel/i),
    ).not.toBeInTheDocument();
  });

  it("has no axe violations with a plan on screen", async () => {
    const stream = mount();
    emitPlan(stream);

    expect(await screen.findByText("#1")).toBeInTheDocument();
    expect(await axe(stream.container)).toHaveNoViolations();
  });
});
