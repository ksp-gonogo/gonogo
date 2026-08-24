import {
  act,
  clearPlanDrafts,
  fireEvent,
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
 * the property: nothing reaches the vessel until Send, and what does reach it is
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
        vesselId: "vessel-1",
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
  // would be asserting against a widget that has no vessel.
  await screen.findByRole("button", { name: "Draft plan" });
  return { fixture, view };
}

/** Types into a field by its VISIBLE label, which is how an operator finds it. */
function setField(label: string, value: string) {
  act(() => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

function press(name: string) {
  act(() => {
    screen.getByRole("button", { name }).click();
  });
}

describe("PlanComposer", () => {
  it("sends nothing to the vessel while a plan is being composed", async () => {
    // The whole reason drafts exist here rather than aboard: a plan
    // half-composed must never be a plan half-flown, and two operators must be
    // able to work without disturbing each other or the player at the keyboard.
    const { fixture } = await setup();

    press("Draft plan");
    press("Add burn");
    await act(async () => {});

    expect(fixture.transport.sentCommands).toHaveLength(0);
    // Labelled VISIBLY, by `UnitInput`. The composer's first cut had four
    // unlabelled boxes carrying only an aria-label, which reads as a column of
    // bare numbers to anyone looking at the screen.
    expect(screen.getByLabelText("Ignition")).toBeTruthy();
    expect(screen.getByText("Tangent")).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();
    expect(screen.getByText("Binormal")).toBeTruthy();
  });

  it("sends the whole plan as one message carrying both instants", async () => {
    // One plan is one message. Five burn commands are five light-times, each
    // able to arrive late or not at all.
    const { fixture } = await setup();
    fixture.transport.setCommandHandler(() => ({ success: true }));

    press("Draft plan");
    press("Add burn");
    press("Add burn");
    // Two acts, deliberately. Saving ends composing and nothing leaves; the
    // plan only reaches the vessel from the list it lands in.
    press("Save draft");
    press("Upload to vessel");
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
    expect(args.vesselId).toBe("vessel-1");
    expect(args.burns).toHaveLength(2);
    // Both instants travel, because they answer different questions: when the
    // operator decided, and how old their information already was.
    expect(args.composedAtViewUt).toBe(VIEW_UT);
    expect(args.observedAtUt).toBe(VIEW_UT);
  });

  it("refuses to send a plan that cannot arrive before its own first burn", async () => {
    // The whole reason sending is a separate act with a verdict on it. A press
    // leaves at a view instant already one light time old and spends another in
    // flight, so a burn closer than the round trip cannot be flown from here
    // however healthy the link looks. Without this the control reads as live,
    // the send is accepted, and the write lands after the burn should have lit.
    const { fixture } = await setup();
    // The one-way delay comes off `comms.delay`, which is what `useCommand`
    // reads it from. A fixture that only pinned the clock would report this
    // vantage as instant, which is the state the verdict exists to tell apart.
    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 600 }, { validAt: VIEW_UT });
    });

    press("Draft plan");
    press("Add burn");
    // Inside the round trip: 2 x 600s of delay against a burn 300s out.
    setField("Ignition", String(VIEW_UT + 300));
    press("Save draft");

    await act(async () => {});
    expect(screen.getByText("Too late")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Upload to vessel" }),
    ).toBeDisabled();
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });

  it("says why when the vessel declines the plan", async () => {
    // Stock refuses this command outright, with a real reason. A control that
    // merely stopped spinning would leave the operator guessing at a decision
    // that has already been made.
    const { fixture } = await setup();
    fixture.transport.setCommandHandler(() => ({
      success: false,
      detail: "Stock has no way to install a composed plan in one step.",
    }));

    press("Draft plan");
    // Two acts, deliberately. Saving ends composing and nothing leaves; the
    // plan only reaches the vessel from the list it lands in.
    press("Save draft");
    press("Upload to vessel");
    await act(async () => {});

    expect(screen.getByRole("status").textContent).toContain(
      "no way to install a composed plan",
    );
  });
});
