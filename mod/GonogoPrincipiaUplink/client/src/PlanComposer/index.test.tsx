import {
  act,
  clearPlanDrafts,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { PlanComposer } from "./index";

/**
 * Composing a plan at the command centre and sending it whole.
 *
 * <p>The assertions are about what is and is not on the wire, because that is
 * the property: nothing reaches the craft until Send, and what does reach it is
 * one message rather than a burn at a time.</p>
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  // After the unmounts, never before: the draft store is module scope and so
  // outlives a tree, and clearing it while one is still mounted notifies its
  // subscribers outside `act`.
  clearPlanDrafts();
});

const VIEW_UT = 4_000;

const CARRIED = [
  "vessel.identity",
  "vessel.orbit",
  "vessel.maneuver.plan.send",
  "comms.delay",
];

async function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
  });
  const view = render(
    <fixture.Provider>
      <PlanComposer />
    </fixture.Provider>,
  );
  renderedTrees.push(view.unmount);
  // `validAt` is stated rather than defaulted: the transport's default is 0, so
  // an emit with no meta lands four thousand seconds behind a clock pinned at
  // `VIEW_UT`, and every test here would quietly exercise the stale path.
  act(() => {
    fixture.emit(
      "vessel.identity",
      {
        vesselId: "craft-1",
        name: "Probe",
        vesselType: 0,
        situation: 0,
      },
      { validAt: VIEW_UT },
    );
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 850_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        mu: 3.5316e12,
      },
      { validAt: VIEW_UT },
    );
  });
  // Delivery is asynchronous: the samples reach the store after the emit
  // returns, so a synchronous assertion reads the pending state and every test
  // would be asserting against a widget that has no craft.
  await screen.findByRole("button", { name: "New plan" });
  return { fixture, view };
}

function press(name: string) {
  act(() => {
    screen.getByRole("button", { name }).click();
  });
}

describe("PlanComposer", () => {
  it("sends nothing to the craft while a plan is being composed", async () => {
    // The whole reason drafts exist here rather than aboard: a plan
    // half-composed must never be a plan half-flown, and two operators must be
    // able to work without disturbing each other or the player at the keyboard.
    const { fixture } = await setup();

    press("New plan");
    press("Add burn");
    await act(async () => {});

    expect(fixture.transport.sentCommands).toHaveLength(0);
    expect(screen.getByLabelText("Burn 1 ignition")).toBeTruthy();
  });

  it("sends the whole plan as one message carrying both instants", async () => {
    // One plan is one message. Five burn commands are five light-times, each
    // able to arrive late or not at all.
    const { fixture } = await setup();
    fixture.transport.setCommandHandler(() => ({ success: true }));

    press("New plan");
    press("Add burn");
    press("Add burn");
    press("Send to craft");
    await act(async () => {});

    expect(fixture.transport.sentCommands).toHaveLength(1);
    const sent = fixture.transport.sentCommands[0];
    expect(sent.command).toBe("vessel.maneuver.plan.send");
    const args = sent.args as {
      vesselId?: string;
      burns?: unknown[];
      composedAtViewUt?: number;
      observedAtUt?: number;
    };
    expect(args.vesselId).toBe("craft-1");
    expect(args.burns).toHaveLength(2);
    // Both instants travel, because they answer different questions: when the
    // operator decided, and how old their information already was.
    expect(args.composedAtViewUt).toBe(VIEW_UT);
    expect(args.observedAtUt).toBe(VIEW_UT);
  });

  it("says why when the craft declines the plan", async () => {
    // Stock refuses this command outright, with a real reason. A control that
    // merely stopped spinning would leave the operator guessing at a decision
    // that has already been made.
    const { fixture } = await setup();
    fixture.transport.setCommandHandler(() => ({
      success: false,
      detail: "Stock has no way to install a composed plan in one step.",
    }));

    press("New plan");
    press("Send to craft");
    await act(async () => {});

    expect(screen.getByRole("status").textContent).toContain(
      "no way to install a composed plan",
    );
  });
});
