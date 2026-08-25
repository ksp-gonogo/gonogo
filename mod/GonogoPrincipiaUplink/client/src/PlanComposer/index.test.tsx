import {
  act,
  clearPlanDrafts,
  fireEvent,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { utOfParts } from "@ksp-gonogo/ui-kit";
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

/**
 * The instant one burn's date fields add up to.
 *
 * <p>Recomposed through the kit's own `utOfParts` rather than read off a single
 * box: an instant is entered on the game's calendar, so there is no one number
 * to read, and doing the arithmetic here by hand would be a second answer to how
 * long a day is.</p>
 */
function ignitionUt(index = 0): number {
  const at = (column: string) =>
    Number(
      (
        screen.getAllByLabelText(`Ignition ${column}`)[
          index
        ] as HTMLInputElement
      ).value,
    );
  return utOfParts({
    year: at("YEAR"),
    day: at("DAY"),
    hour: at("HR"),
    minute: at("MIN"),
    second: at("SEC"),
  });
}

/** Sets a burn's ignition to a whole UT, as seconds from the epoch. */
function setIgnition(ut: number) {
  for (const [column, digits] of [
    ["YEAR", "1"],
    ["DAY", "1"],
    ["HR", "0"],
    ["MIN", "0"],
    // Last, and carrying the whole instant: the field does not clamp, so an
    // out-of-range component rolls up through the calendar exactly as a typed
    // one does.
    ["SEC", String(ut)],
  ] as const) {
    setField(`Ignition ${column}`, digits);
  }
}

function press(name: string) {
  act(() => {
    screen.getByRole("button", { name }).click();
  });
}

/** Presses an armed control twice: once to arm, once to commit. */
function confirm(name: string, confirmName: string) {
  press(name);
  press(confirmName);
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
    expect(screen.getByLabelText("Ignition DAY")).toBeTruthy();
    expect(screen.getByText("Tangent")).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();
    expect(screen.getByText("Binormal")).toBeTruthy();
  });

  it("enters an ignition as a DATE, with a wheel to nudge it by", async () => {
    // An operator holds a burn as a day and a time, never as a count of
    // seconds, and finds a transfer by nudging one a few minutes at a time and
    // reading what happens. One number box serves neither.
    await setup();

    press("Draft plan");
    press("Add burn");
    await act(async () => {});

    expect(screen.getByLabelText("Ignition YEAR")).toBeTruthy();
    expect(screen.getByLabelText("Ignition rate")).toBeTruthy();
    // A notch is an INTERVAL. The instant is a `ut` and what moves it is an
    // `s`, and the control says so rather than leaving it to be assumed.
    expect(screen.getByText("60 s / notch")).toBeVisible();
  });

  it("nudges the ignition by a whole notch from the wheel", async () => {
    await setup();

    press("Draft plan");
    press("Add burn");
    await act(async () => {});
    const before = ignitionUt();

    act(() => {
      fireEvent.keyDown(screen.getByLabelText("Ignition rate"), {
        key: "ArrowRight",
      });
    });

    expect(ignitionUt()).toBe(before + 60);
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
    confirm(
      "Upload this flight plan to the vessel",
      "Confirm uploading this flight plan to the vessel",
    );
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
    setIgnition(VIEW_UT + 300);
    press("Save draft");

    await act(async () => {});
    expect(screen.getByText("Too late")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Upload this flight plan to the vessel",
      }),
    ).toBeDisabled();
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });

  it("arms the upload rather than sending it on one press", async () => {
    // An upload REPLACES whatever the craft is flying, there is no undo from
    // this seat, and at a distant vantage the correction is another round trip
    // behind. A single press on the one control that does that is a plan aboard
    // a vessel because somebody's mouse slipped.
    const { fixture } = await setup();
    fixture.transport.setCommandHandler(() => ({ success: true }));

    press("Draft plan");
    press("Add burn");
    press("Save draft");
    press("Upload this flight plan to the vessel");
    await act(async () => {});

    // Armed, and nothing has left.
    expect(fixture.transport.sentCommands).toHaveLength(0);
    expect(
      screen.getByRole("button", {
        name: "Confirm uploading this flight plan to the vessel",
      }),
    ).toBeTruthy();

    press("Confirm uploading this flight plan to the vessel");
    await act(async () => {});
    expect(fixture.transport.sentCommands).toHaveLength(1);
  });

  it("seeds a new burn at an instant the vessel can still act on", async () => {
    // A seeded burn is the one an operator who does not retype the instant
    // sends. Seeding it at the instant the state was OBSERVED puts it two light
    // times behind the moment the plan arrives, and the mod refuses any burn
    // ignoiting at or before arrival, so the whole plan is refused: the control
    // offers a plan that cannot be flown and says nothing about it until the
    // craft answers.
    await setup();

    press("Draft plan");
    press("Add burn");
    await act(async () => {});

    expect(ignitionUt()).toBeGreaterThan(VIEW_UT);
  });

  it("seeds a burn ahead of the round trip at a delayed vantage", async () => {
    // The instant that has to be cleared is ARRIVAL, not the view: the press
    // leaves one light time behind reality and spends another in flight. A seed
    // ahead of the view instant but inside the round trip is refused on arrival
    // exactly as one in the past is.
    const { fixture } = await setup();
    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 600 }, { validAt: VIEW_UT });
    });

    press("Draft plan");
    press("Add burn");
    await act(async () => {});

    expect(ignitionUt()).toBeGreaterThan(VIEW_UT + 2 * 600);
    // And the window it lands in is open, which is the same arithmetic the row
    // below shows: a seed that arrives already too late is no better than one in
    // the past.
    press("Save draft");
    await act(async () => {});
    expect(screen.queryByText("Too late")).toBeNull();
  });

  it("seeds a second burn after the first rather than on top of it", async () => {
    // Two burns at one instant are not in time order, which the mod refuses on
    // its own account: a plan whose burns are not ordered was either composed
    // wrongly or reordered in transit. Seeding every burn at its predecessor's
    // instant made every multi-burn plan refusable from the first press.
    await setup();

    press("Draft plan");
    press("Add burn");
    press("Add burn");
    await act(async () => {});

    expect(screen.getAllByLabelText("Ignition SEC")).toHaveLength(2);
    expect(ignitionUt(1)).toBeGreaterThan(ignitionUt(0));
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
    confirm(
      "Upload this flight plan to the vessel",
      "Confirm uploading this flight plan to the vessel",
    );
    await act(async () => {});

    expect(screen.getByRole("status").textContent).toContain(
      "no way to install a composed plan",
    );
  });
});
