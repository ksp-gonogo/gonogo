import { CommandErrorCode, Staleness } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  PrincipiaWriteOutcome,
  PrincipiaWriteRefusal,
} from "../__generated__/contract";
import { axe } from "../test/axe";
import { BurnEditor } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const VIEW_UT = 10_000;

// `comms.delay` is carried because it is what `useCommand` reads its one-way
// delay off, and the editable-until deadline is derived from that one-way. A
// fixture that left it out would report every vantage as instant, which is the
// state the deadline exists to distinguish from.
const CARRIED = ["principia.plan", "comms.delay"];

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
  });
  const result = render(
    <stream.Provider>
      <BurnEditor />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, container: result.container };
}

/**
 * A plan carrying one burn, with the write surface armed.
 *
 * `validAt` is stated rather than defaulted, for the reason the sibling widget's
 * fixture states it: the transport's default is 0, so an emit with no meta lands
 * ten thousand seconds behind a clock pinned at `VIEW_UT` and every test would
 * quietly be exercising the stale path.
 *
 * The emit is AWAITED and then WAITED ON, because delivery is asynchronous: the
 * sample reaches the store after the emit returns, so a synchronous assertion
 * reads the pending state and every test in this file would be asserting against
 * an empty widget while looking like it had a plan. The slot badge is the settle
 * condition because it renders for every plan, including one with no burns.
 */
async function emitPlan(
  stream: ReturnType<typeof mount>,
  overrides: Record<string, unknown> = {},
) {
  act(() => {
    stream.emit("principia.plan", plan(overrides), { validAt: VIEW_UT });
  });
  await screen.findByText(/^PLAN \d+ OF \d+$/);
}

/**
 * A plan write's answer as the mod actually sends it: a `CommandResult` whose
 * `payload` is the receipt.
 *
 * The receipt used to be scripted here FLAT, as if it were the whole reply, and
 * the widget read it flat to match. Both halves of that were wrong in the same
 * direction, so the pair agreed and the fixture proved nothing: the banner it
 * asserted has never once appeared against a real mod. `JsonWriter`'s
 * `AppendCommandResult` is what the wire actually carries, and this is that
 * shape.
 */
function planWriteReply(receipt: Record<string, unknown>) {
  return { success: true, errorCode: 0, payload: receipt };
}

/** The last `command-request` this widget put on the wire, verbatim. */
function lastSent(stream: ReturnType<typeof mount>) {
  const sent = stream.transport.sentCommands;
  const last = sent[sent.length - 1];
  if (last === undefined) throw new Error("no command was sent");
  return last;
}

/** Open burn 1, press ADD LIKE THIS, and confirm it. */
async function addABurnLikeThisOne() {
  await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Add a burn copied from this one" }),
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Confirm adding a burn copied from this one",
    }),
  );
}

/** Open burn 1, press REMOVE, and confirm it. */
async function removeTheSelectedBurn() {
  await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Remove this burn from the plan" }),
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Confirm removing this burn from the plan",
    }),
  );
}

/** Open burn 1, press APPLY, and confirm it. */
async function applyTheEditedBurn() {
  await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Apply the edited burn" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm applying the edited burn" }),
  );
}

function burn(overrides: Record<string, unknown> = {}) {
  return {
    index: 0,
    ignitionUt: VIEW_UT + 3600,
    cutoffUt: VIEW_UT + 3660,
    durationSeconds: 60,
    timeToHalfDeltaVSeconds: 30,
    deltaV: 141.4,
    deltaVTangent: 100,
    deltaVNormal: 100,
    deltaVBinormal: 0,
    coordinateSystem: 1,
    inertiallyFixed: false,
    thrustKilonewtons: 60,
    specificImpulseSeconds: 320,
    initialMassTons: 12.5,
    finalMassTons: 11.9,
    massFlowKilogramsPerSecond: 19.1,
    frameType: 6000,
    frameEditable: true,
    executing: false,
    anomalous: false,
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    vesselId: "vessel-1",
    sampledAtUt: VIEW_UT,
    planExists: true,
    planCount: 2,
    selectedPlan: 0,
    initialTimeUt: VIEW_UT,
    desiredFinalTimeUt: VIEW_UT + 100_000,
    actualFinalTimeUt: VIEW_UT + 100_000,
    anomalousBurnCount: 0,
    optimisationRunning: false,
    writeSurface: {
      available: true,
      armed: true,
      // STATED, not left off. `armed` and `burnLayoutVerified` are independent
      // on the wire and the contract says so: arming is allowed on a partial
      // verification, so an armed surface whose burn struct never survived a
      // round trip is a real state and the one every burn write is refused in.
      // A fixture omitting the field leaves it `undefined`, which is neither
      // verdict, and every test in this file would have been asserting against
      // a surface the mod never publishes.
      burnLayoutVerified: true,
      integratorLayoutVerified: true,
      reason: null,
      analysedVersion: "analysed",
      detectedVersion: "analysed",
    },
    integrator: {
      maxSteps: 1024,
      lengthToleranceMetres: 1,
      speedToleranceMetresPerSecond: 1,
      integratorKind: 1,
      generalizedIntegratorKind: 2,
    },
    burns: [burn()],
    ...overrides,
  };
}

describe("BurnEditor", () => {
  it("says nothing has been read rather than showing an empty plan", async () => {
    mount();

    expect(screen.getByText("NO PLAN READING")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The five-field instant is the whole point of §1.4's first bullet: one
   * seconds box makes every edit an arithmetic problem about how long a day is.
   */
  it("edits the ignition instant as a calendar date, not a seconds field", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    for (const name of ["YEAR", "DAY", "HR", "MIN", "SEC"]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(
      screen.getByRole("button", { name: "Ignition later by 1h" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /** The full triple, in the producer's own axis words. */
  it("offers all three delta-v components", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.getByLabelText("TANGENT / prograde")).toHaveValue(100);
    expect(screen.getByLabelText("NORMAL")).toHaveValue(100);
    expect(screen.getByLabelText("BINORMAL")).toHaveValue(0);
    await act(async () => {});
  });

  /** §1.5: the propulsion is part of the plan, because the burn is integrated. */
  it("shows the planned mass flow and initial thrust", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.getByText("MASS FLOW")).toBeInTheDocument();
    expect(screen.getByText("THRUST")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * Countdown to the burn's START. Principia's own convention, and the reason
   * the row shows an hour rather than the half-burn instant a stock node would
   * have been placed at.
   */
  it("counts down to ignition rather than to a node", async () => {
    const stream = mount();
    await emitPlan(stream);

    // One hour of the game's own calendar from the pinned view instant.
    expect(screen.getByText(/1h/)).toBeInTheDocument();
    await act(async () => {});
  });

  it("names the two attitude modes rather than showing an unlabelled checkbox", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(
      screen.getByRole("button", { name: "FRAME-RELATIVE" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "FRAME-RELATIVE" }),
    );
    expect(
      screen.getByRole("button", { name: "INERTIALLY FIXED" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  it("offers Principia's own instant-impulse profile", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(
      screen.getByRole("button", { name: "INSTANT IMPULSE" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * An unarmed surface disables the edit rather than letting the operator
   * compose one and be refused. The reason travels with the plan, so it is on
   * screen before anything is tried.
   */
  it("freezes the controls and says why when the surface is not armed", async () => {
    const stream = mount();
    await emitPlan(stream, {
      writeSurface: {
        available: true,
        armed: false,
        reason: "Not armed. Arming runs a round trip of Principia's own burn.",
        analysedVersion: "analysed",
        detectedVersion: "analysed",
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.getByText("NOT ARMED")).toBeInTheDocument();
    expect(
      screen.getByText(/round trip of Principia's own burn/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("DAY")).toBeDisabled();
    expect(screen.getByLabelText("NORMAL")).toBeDisabled();
    await act(async () => {});
  });

  /**
   * A build whose writes were never analysed cannot even be armed, and the plan
   * is still shown: fail closed to READ-ONLY, not to nothing.
   */
  it("still shows the plan when the write surface is unavailable", async () => {
    const stream = mount();
    await emitPlan(stream, {
      writeSurface: {
        available: false,
        armed: false,
        reason: "Principia build not analysed for flight-plan WRITES.",
        analysedVersion: "analysed",
        detectedVersion: "something-else",
      },
    });

    expect(screen.getByRole("button", { name: "Burn 1" })).toBeInTheDocument();
    expect(
      screen.getByText(/not analysed for flight-plan WRITES/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Arm the flight-plan write surface" }),
    ).toBeDisabled();
    await act(async () => {});
  });

  /**
   * The frame line names the burn's frame with the bodies it is declined with,
   * because the operator reads it to decide whether the delta-v beside it is
   * quoted in the frame the map is drawn in. A frame's kind alone cannot answer
   * that: two burns centred on different bodies are both "body-centred
   * inertial" and are not the same frame.
   */
  it("names the burn's manoeuvring frame with its own bodies", async () => {
    const stream = mount();
    await emitPlan(stream, {
      burns: [burn({ frameType: 6000, centreBody: "Kerbin" })],
    });
    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.getByText("Kerbin-Centred Inertial")).toBeInTheDocument();
    await act(async () => {});
  });

  /** A frame declined with a PAIR reads both of them, not the centre slot. */
  it("names a paired frame with both of its bodies", async () => {
    const stream = mount();
    await emitPlan(stream, {
      burns: [
        burn({
          frameType: 6004,
          frameEditable: false,
          primaryBody: "Kerbol",
          secondaryBody: "Kerbin",
        }),
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.getByText("Kerbol\u2013Kerbin Lagrange")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * A burn whose manoeuvring frame cannot be written back is marked on the list
   * AND frozen in the editor. Sending it would abort the game, and the producer's
   * own guard against that is invisible from here.
   */
  it("marks and freezes a burn whose frame cannot be written back", async () => {
    const stream = mount();
    await emitPlan(stream, {
      burns: [burn({ frameType: 6004, frameEditable: false })],
    });

    expect(screen.getByText("FRAME LOCKED")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(
      screen.getByText("THIS FRAME CANNOT BE WRITTEN BACK"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("NORMAL")).toBeDisabled();
    await act(async () => {});
  });

  it("marks a burn that is running", async () => {
    const stream = mount();
    await emitPlan(stream, { burns: [burn({ executing: true })] });

    expect(screen.getByText("BURNING")).toBeInTheDocument();
    await act(async () => {});
  });

  /** Which of the ten slots is live, because the numbers all belong to it. */
  it("says which plan slot the numbers belong to", async () => {
    const stream = mount();
    await emitPlan(stream, { selectedPlan: 1, planCount: 3 });

    expect(screen.getByText("PLAN 2 OF 3")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The copy here used to send the operator into the game: "add the first one
   * in Principia's own planner, the console copies an existing burn rather
   * than composing one". That stopped being true when PlanComposer gained an
   * "Add burn" button and `useSendPlan`, and nothing caught it, because the
   * belief was written down three times over: the copy, this test's name, and
   * its assertion, all agreeing with each other and none with the code.
   *
   * A console that tells an operator to go and use the game is the one thing
   * this product exists not to do, so it is asserted here rather than left to
   * a reader to notice.
   */
  it("sends a plan with no burns to the composer, not into the game", async () => {
    const stream = mount();
    await emitPlan(stream, { burns: [] });

    expect(screen.getByText(/Compose one below/)).toBeInTheDocument();
    expect(screen.queryByText(/Principia's own/)).toBeNull();
    await act(async () => {});
  });

  /**
   * Every write confirms. A plan write is persisted into the player's save, can
   * move and delete stock maneuver nodes on the flying craft, and re-integrates
   * on the game's own thread.
   */
  it("confirms before sending an edit", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Apply the edited burn" }),
    );

    expect(
      screen.getByRole("button", {
        name: "Confirm applying the edited burn",
      }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * A plan whose keyframes stopped arriving is still SHOWN, and is no longer
   * EDITABLE. Both halves are asserted here because either alone passes for the
   * wrong reason: a widget that blanked on a stale reading would satisfy the
   * disabled assertion, and the one that shipped satisfied the visible one by
   * collapsing every non-pending arm into a live plan.
   *
   * The burn index and the burn count both come off this reading, so a write
   * bounded against one from an hour ago is bounded against a plan that may no
   * longer have that many burns.
   */
  it("shows a stale plan and refuses to edit it, naming what is out of contact", async () => {
    const stream = mount();

    act(() => {
      // Server-stamped, not merely old. Staleness is inferred from missed
      // keyframes rather than from the sample's own age, so a fixture that only
      // backdated `validAt` would still deliver a LIVE reading and this test
      // would pass against the collapsing version.
      stream.emit("principia.plan", plan(), {
        validAt: VIEW_UT - 3_600,
        staleness: Staleness.LastBeforeBlackout,
      });
    });
    await screen.findByText(/^PLAN \d+ OF \d+$/);

    expect(screen.getByRole("button", { name: "Burn 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    // The refusal is asserted BEFORE the badge, so a run against the collapsing
    // version names the defect (an editable stale plan) rather than a missing
    // label.
    expect(screen.getByLabelText("NORMAL")).toBeDisabled();
    expect(screen.getByLabelText("DAY")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Apply the edited burn" }),
    ).toBeDisabled();
    expect(screen.getByText("OUT OF CONTACT")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The complement, and what stops the assertion above passing for a widget that
   * simply never enables anything: a plan observed at the view instant is
   * editable.
   */
  it("edits a plan observed at the view instant", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.queryByText("OUT OF CONTACT")).not.toBeInTheDocument();
    expect(screen.getByLabelText("NORMAL")).toBeEnabled();
    await act(async () => {});
  });

  /**
   * The failure this pair exists for: the ignition countdown reads a full hour
   * and the burn is already unreachable.
   *
   * A press leaves at the operator's VIEW instant, which trails reality by one
   * one-way delay, and the command then spends a second one-way delay in
   * flight. So an edit lands two one-way delays after the instant shown on
   * screen, and at a thirty-light-minute vantage every control stays enabled
   * for the last sixty minutes of a countdown during which nothing sent can
   * arrive.
   */
  it("shuts the edit window two one-way delays before ignition", async () => {
    const stream = mount();
    act(() => {
      // Thirty light-minutes one way. The fixture burn ignites an hour after the
      // pinned view instant, so the window has shut exactly now.
      stream.emit("comms.delay", { oneWaySeconds: 1_800 });
    });
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.getByText("EDIT WINDOW SHUT")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Apply the edited burn" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Add a burn copied from this one",
      }),
    ).toBeDisabled();
    await act(async () => {});
  });

  /**
   * Two one-way delays and no more. A burn two hours out at the same vantage is
   * editable for another hour, and the countdown says an hour rather than the
   * two the ignition clock shows.
   */
  it("counts the edit window down to two one-way delays before ignition", async () => {
    const stream = mount();
    act(() => {
      stream.emit("comms.delay", { oneWaySeconds: 1_800 });
    });
    await emitPlan(stream, {
      burns: [burn({ ignitionUt: VIEW_UT + 7_200, cutoffUt: VIEW_UT + 7_260 })],
    });

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.queryByText("EDIT WINDOW SHUT")).not.toBeInTheDocument();
    expect(screen.getByText(/EDIT WINDOW/)).toHaveTextContent("T−1h");
    expect(
      screen.getByRole("button", { name: "Apply the edited burn" }),
    ).toBeEnabled();
    await act(async () => {});
  });

  /**
   * The row has to carry the verdict too. An operator picks a burn off the list
   * before any of the form exists, and a list that offers a burn nothing can
   * reach is what sends them into a form to compose an edit that cannot land.
   */
  it("marks a burn on the list whose edit window has shut", async () => {
    const stream = mount();
    act(() => {
      stream.emit("comms.delay", { oneWaySeconds: 1_800 });
    });
    await emitPlan(stream);

    expect(screen.getByText("TOO LATE TO EDIT")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * At a vantage with no delay the deadline IS ignition, and the existing
   * ignition countdown already says so. A second countdown reading the same
   * number would be furniture.
   */
  it("says nothing about an edit window when the vantage has no delay", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.queryByText(/EDIT WINDOW/)).not.toBeInTheDocument();
    expect(screen.queryByText("TOO LATE TO EDIT")).not.toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * An arm is not a burn verdict, and the two burn writes need the verdict.
   *
   * `PlanCommands.EditBurn` refuses both with `LayoutUnverified` whenever the
   * plan holds burns and `BurnLayoutVerified` is false, and that state is
   * REACHABLE beside `armed: true`: `PrincipiaLayoutProbe.Run` records the
   * verdicts and returns null "whatever the verdicts were", and `Arm` refuses
   * only when NEITHER struct survived. So a burn probe that failed while the
   * integrator's passed arms the surface and leaves every burn edit refused.
   *
   * The mod publishes `burnLayoutVerified` for exactly this, in its own words:
   * "an operator had no way to know that the check covering the edit they were
   * about to make had never run". Nothing in this Uplink read the field.
   *
   * REMOVE is deliberately not frozen with them: dropping a burn writes no burn
   * struct, and `PlanCommands.RemoveBurn` takes no verdict.
   */
  it("freezes the two burn writes when the burn struct was never verified", async () => {
    const stream = mount();
    await emitPlan(stream, {
      writeSurface: {
        available: true,
        armed: true,
        burnLayoutVerified: false,
        integratorLayoutVerified: true,
        reason:
          "Principia's burn came back changed from a round trip through the plugin.",
        analysedVersion: "analysed",
        detectedVersion: "analysed",
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(
      screen.getByRole("button", { name: "Apply the edited burn" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add a burn copied from this one" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove this burn from the plan" }),
    ).toBeEnabled();
    // Beside the controls it darkened, not only beside the ARM button at the
    // top of the section. The consequence rather than a second copy of the
    // surface's own sentence, which is already up there.
    expect(
      screen.getByText(/APPLY and ADD write one and are refused/),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The whole insert, end to end: the press, the args the mod binds, and the
   * receipt read back off the reply.
   *
   * <p>The args are asserted VERBATIM, and two absences in them are the point.
   * `PrincipiaBurnEditArgs` is "every field optional, an omitted field means
   * leave it", and the burn the plugin receives is the one at `burnIndex` READ
   * BACK with the stated fields changed. So ADD LIKE THIS sends the instant and
   * the Dv triple and sends neither `inertiallyFixed` nor `profile`: the new
   * burn takes the TEMPLATE's attitude mode and propulsion, not the draft's,
   * even though both toggles are live beside the button. APPLY sends both.</p>
   *
   * <p>The request id is `insert-${index}-${ignitionUt}` and the Dv triple is
   * not in it, which makes it the weakest key of the ten: two different burns
   * composed at the same index and the same instant go under one id, and the
   * second is answered out of the mod's receipt cache.</p>
   */
  it("inserts a burn with the draft's instant and components, at the index it was copied from", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: `insert-0-${VIEW_UT + 3600}`,
        replayed: false,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await addABurnLikeThisOne();

    const sent = lastSent(stream);
    expect(sent.command).toBe("principia.plan.burn.insert");
    expect(sent.args).toEqual({
      vesselId: "vessel-1",
      requestId: `insert-0-${VIEW_UT + 3600}`,
      burnIndex: 0,
      ignitionUt: VIEW_UT + 3600,
      deltaVTangent: 100,
      deltaVNormal: 100,
      deltaVBinormal: 0,
    });
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  /** The replay arm on insert: the same id twice is one burn, not two. */
  it("says an insert answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: `insert-0-${VIEW_UT + 3600}`,
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await addABurnLikeThisOne();

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The whole remove, end to end. The index is the whole of the request:
   * `PrincipiaBurnRemoveArgs` carries no ignition instant and no components, so
   * the mod drops whichever burn holds that index WHEN THE WRITE LANDS.
   *
   * <p>Which is why the id is `remove-${index}` and why that is the second
   * weakest of the ten: indices shift as burns are added and removed, so the
   * same id names a different burn on either side of any other write, and a
   * repeat is answered out of the receipt cache rather than dropping the burn
   * now at that index.</p>
   */
  it("removes a burn by the index alone, which is all the command carries", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "remove-0",
        replayed: false,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await removeTheSelectedBurn();

    const sent = lastSent(stream);
    expect(sent.command).toBe("principia.plan.burn.remove");
    expect(sent.args).toEqual({
      vesselId: "vessel-1",
      requestId: "remove-0",
      burnIndex: 0,
    });
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  /** The replay arm on remove. */
  it("says a remove answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "remove-0",
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await removeTheSelectedBurn();

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * A write the mod answered from its own store is not a write.
   *
   * The request id is content-addressed from the draft, so tuning a burn to 105
   * and back to 100 sends the SAME id as the first edit did, and the mod answers
   * the second one with the receipt it stored the first time: the plugin is never
   * called, the plan stays at 105, and the receipt reads `Written`. Nudge and
   * revert is what tuning is, so a control that reports that as success reports
   * the plan changing when it did not.
   */
  it("says a write answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "replace-0",
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await applyTheEditedBurn();

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The RECEIPT READER, and not the refusal path.
   *
   * <p>A receipt is the authority on whether anything landed, and `replayed` is
   * only one of the two ways it can say no. The contract's own words: "Nothing
   * here can render as a quiet success." A receipt reporting anything but
   * `Written` is a write that did not happen, whatever the envelope around it
   * said, and the widget has to read the receipt to know that.</p>
   *
   * <p><b>The pairing scripted here is one the producer never sends, and this
   * test is not coverage of a refusal.</b> `PlanCommands.Settle` answers every
   * non-`Written` outcome with `Success = false`, so a refused write REJECTS in
   * the spine, `onConfirmed` never runs, and the banner asserted below cannot
   * fire on that path in production: only the replay arm reaches it. It is
   * scripted anyway because the receipt is the authority and the envelope is
   * not, and because that pairing is the producer's choice rather than a
   * property of the wire. What an operator actually meets on a refusal is the
   * test after next.</p>
   */
  it("reads a non-Written outcome off the receipt itself, whatever the envelope claimed", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "replace-0",
        outcome: PrincipiaWriteOutcome.Refused,
        refusal: PrincipiaWriteRefusal.IgnitionInPast,
      }),
    );
    await emitPlan(stream);

    await applyTheEditedBurn();

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    expect(screen.getByText(/IgnitionInPast/)).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * An arm answered from the mod's own store is not an arm.
   *
   * This one's request id is composed from the VESSEL alone, so it never
   * varies: the second press an operator makes on the same craft sends the id
   * the first went under, and `PlanCommands.Arm` answers it out of
   * `_receipts` before it touches the plugin or the write surface. Both presses
   * resolve, so the control shows the same confirmation for a re-arm that did
   * nothing as for the arm that granted the permission.
   */
  it("says an arm answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "arm-vessel-1",
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", { name: "Arm the flight-plan write surface" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm arming the flight-plan write surface",
      }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /** The same reader on the arm control. Not refusal coverage either. */
  it("reads a non-Written arm outcome off the receipt itself, whatever the envelope claimed", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "arm-vessel-1",
        outcome: PrincipiaWriteOutcome.Refused,
        refusal: PrincipiaWriteRefusal.LayoutUnverified,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", { name: "Arm the flight-plan write surface" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm arming the flight-plan write surface",
      }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    expect(screen.getByText(/LayoutUnverified/)).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The refusal path an arm actually takes, and the mod's own sentence reaching
   * the operator on it.
   *
   * <p>`Settle` answers a refused arm with `Success = false`, `Code(...)` for
   * the guard, and `result.Detail` as the sentence. The spine rejects on that
   * and the control settles refused, so there is no receipt banner: the button
   * is the whole surface, and its accessible name is the sentence.</p>
   *
   * <p><b>`detail` is the only clause a plan refusal has.</b> None of the ten
   * ever sets a `LimitBreach`, and `LayoutUnverified` maps onto the coarse
   * `ModeUnavailable`, whose general clause is "the game would not say why". So
   * a control that rebuilt the refusal without copying `detail` said exactly
   * that, against a mod whose sentence said exactly why. Both halves are
   * asserted, because the sentence being present is only half the fact: the
   * general clause has to be gone.</p>
   */
  it("shows the mod's own sentence when an arm is refused", async () => {
    const stream = mount();
    const said =
      "Principia's burn struct has not survived a round trip in this session, " +
      "so nothing will be written through it";
    stream.transport.setCommandHandler(() => ({
      success: false,
      errorCode: CommandErrorCode.ModeUnavailable,
      detail: said,
      payload: {
        requestId: "arm-vessel-1",
        replayed: false,
        outcome: PrincipiaWriteOutcome.Refused,
        refusal: PrincipiaWriteRefusal.LayoutUnverified,
        refusalDetail: said,
      },
    }));
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", { name: "Arm the flight-plan write surface" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm arming the flight-plan write surface",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: `Arm the flight-plan write surface refused: ${said}.`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /the game would not say why/ }),
    ).not.toBeInTheDocument();
    // A rejection never resolves, so `onConfirmed` never ran and the widget was
    // handed no receipt to read.
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));
    await axe(stream.container);
  });

  /**
   * A specific impulse is seconds by dimension and is not a length of time, so
   * the duration ladder is the wrong renderer for it. A 320 s engine reaching
   * `<Unit>` under the plain seconds token came out as "5min 20s": a true
   * statement about the wrong quantity, in the same shape as the encounter UT
   * that rendered as "46d 2h" and gave the vocabulary its `ut` token.
   *
   * Asserted on the FORM rather than on the document, because "5min 20s" is a
   * plausible string elsewhere on this widget (a burn's duration is one), and a
   * whole-document assertion would pass or fail for the wrong reason.
   */
  it("renders a specific impulse as a performance figure, not a duration", async () => {
    const stream = mount();
    await emitPlan(stream);
    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    const form = document.querySelector("[data-burn-editor-form]");
    expect(form?.textContent ?? "").toContain("320");
    expect(form?.textContent ?? "").not.toContain("5min 20s");
    await act(async () => {});
  });

  /**
   * The three Dv fields are only three VELOCITIES under the producer's Cartesian
   * coordinate system. Its other three are spherical and put a magnitude and two
   * ANGLES in the same three slots, which the producer's own write rule states
   * in full when it refuses such an edit: writing components onto one "would set
   * a triple the plugin does not read, so the burn would come back unchanged and
   * look like a write that landed".
   *
   * That refusal is on the far side of a light delay and of a press. Until it
   * arrives the editor showed three live boxes, each with `m/s` beside it, over
   * two numbers that are degrees. So the guard is here too, before anything is
   * typed, in the same shape the frame guard already takes.
   *
   * The Cartesian direction is asserted as well, because a badge that showed on
   * every burn would say nothing.
   */
  it("freezes and marks a burn whose Dv is in spherical coordinates", async () => {
    const stream = mount();
    await emitPlan(stream, { burns: [burn({ coordinateSystem: 2 })] });
    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.getByText("DELTA-V NOT IN COMPONENTS")).toBeInTheDocument();
    // The tangent field's label carries its stock gloss, so it is matched by
    // prefix where the other two are exact.
    expect(screen.getByLabelText(/^TANGENT/)).toBeDisabled();
    expect(screen.getByLabelText("NORMAL")).toBeDisabled();
    expect(screen.getByLabelText("BINORMAL")).toBeDisabled();
    // The derived hypotenuse goes with them. Over a magnitude and two angles it
    // is not the size of the burn, and it reads as a plausible one.
    const form = document.querySelector("[data-burn-editor-form]");
    expect(form?.textContent ?? "").toContain(`MAGNITUDE${NULL_DISPLAY}`);
    await act(async () => {});
  });

  it("leaves a Cartesian burn's components editable and unmarked", async () => {
    const stream = mount();
    await emitPlan(stream);
    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));

    expect(screen.queryByText("DELTA-V NOT IN COMPONENTS")).toBeNull();
    expect(screen.getByLabelText(/^TANGENT/)).not.toBeDisabled();
    await act(async () => {});
  });
});
