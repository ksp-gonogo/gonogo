import type { PlanDraft, PlanDraftStore } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandErrorCode,
  ManeuverFrame,
  usePlanDrafts,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  clearPlanDrafts,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  PrincipiaBurnProfile,
  PrincipiaWriteOutcome,
  PrincipiaWriteRefusal,
} from "../__generated__/contract";
import { PlanSlots } from "./index";

/**
 * A plan write's answer as the mod actually sends it: a `CommandResult` whose
 * `payload` is the receipt. See `JsonWriter.AppendCommandResult`, and the
 * sibling helper in `BurnEditor`'s suite for what scripting it FLAT used to
 * hide.
 */
function planWriteReply(receipt: Record<string, unknown>) {
  return { success: true, errorCode: 0, payload: receipt };
}

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  /*
   * After the trees are down, never before: the draft store is module scope and
   * clearing it while a tree is still mounted notifies its subscribers outside
   * `act`.
   */
  clearPlanDrafts();
});

const VIEW_UT = 10_000;

// `comms.delay` is carried because it is what `useCommand` reads its one-way
// delay off, and both the plan's arrival instant and the first burn's window are
// derived from that one-way. A fixture that left it out would report every
// vantage as instant, which is the state those two exist to distinguish from.
const CARRIED = ["principia.plan", "comms.delay"];

/**
 * The screen's draft store, reached the only way a client can: through the hook
 * that hands it over.
 *
 * <p>The store is module scope in the sdk and deliberately not exported, so a
 * test seeds it by mounting something that asks for it. Rendered inside the same
 * tree as the section under test, which is also the arrangement production has:
 * one store per screen, shared by every panel on it.</p>
 */
function DraftProbe({ onStore }: { onStore: (store: PlanDraftStore) => void }) {
  const { store } = usePlanDrafts();
  onStore(store);
  return null;
}

function mount() {
  const stream = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: VIEW_UT,
  });
  let store: PlanDraftStore | null = null;
  const result = render(
    <stream.Provider>
      <DraftProbe
        onStore={(captured) => {
          store = captured;
        }}
      />
      <PlanSlots />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  if (store === null) throw new Error("the draft store was never handed over");
  return {
    ...stream,
    container: result.container,
    store: store as PlanDraftStore,
  };
}

/**
 * Emits and waits, because delivery is asynchronous: the sample reaches the
 * store after the emit returns, so a synchronous assertion reads the pending
 * state and every test here would be asserting against an empty section while
 * looking like it had a plan. The slot badge is the settle condition because it
 * renders for every plan, including a vessel that holds none.
 */
async function emitPlan(
  stream: ReturnType<typeof mount>,
  overrides: Record<string, unknown> = {},
) {
  act(() => {
    stream.emit("principia.plan", plan(overrides), { validAt: VIEW_UT });
  });
  /*
   * The armed badge rather than the slot badge: the slot badge is replaced by
   * "NO PLAN ON THIS VESSEL" for a craft that holds none, and the arm state
   * renders for every plan reading there is.
   */
  await screen.findByText(/^(ARMED|NOT ARMED)$/);
}

function burn(overrides: Record<string, unknown> = {}) {
  return {
    index: 0,
    ignitionUt: VIEW_UT + 3600,
    cutoffUt: VIEW_UT + 3660,
    durationSeconds: 60,
    deltaV: 141.4,
    deltaVTangent: 100,
    deltaVNormal: 100,
    deltaVBinormal: 0,
    coordinateSystem: 1,
    inertiallyFixed: false,
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
    firstFutureBurnIndex: 0,
    optimisationRunning: false,
    writeSurface: {
      available: true,
      armed: true,
      // STATED, not left off. `armed` and `burnLayoutVerified` are independent
      // on the wire, and INSTALL is refused `LayoutUnverified` whenever the
      // slot already holds burns and the second is false. A fixture omitting
      // the field leaves it `undefined`, which is neither verdict.
      burnLayoutVerified: true,
      integratorLayoutVerified: true,
      reason: null,
      analysedVersion: "analysed",
      detectedVersion: "analysed",
    },
    burns: [burn()],
    ...overrides,
  };
}

/**
 * A saved draft for the plan's own vessel, which is what INSTALL offers.
 *
 * Returns the draft, because the id and the revision are what the install's
 * request id is composed from and a test that hard-codes `draft-1@1` is
 * asserting against the store's counter rather than against the rule.
 */
function saveDraft(
  store: PlanDraftStore,
  overrides: {
    frame?: ManeuverFrame;
    ignitionUt?: number;
    vesselId?: string;
  } = {},
): PlanDraft {
  let created: PlanDraft | null = null;
  act(() => {
    const draft = store.create({
      name: "Plan 1",
      vesselId: overrides.vesselId ?? "vessel-1",
      observedAt: value("ut", VIEW_UT),
      burns: [
        {
          ignitionUt: value("ut", overrides.ignitionUt ?? VIEW_UT + 7200),
          frame: overrides.frame ?? ManeuverFrame.TangentNormalBinormal,
          dvRadial: value("m/s", 120),
          dvNormal: value("m/s", 0),
          dvPrograde: value("m/s", 0),
          inertiallyFixed: false,
        },
      ],
    });
    created = store.update(draft.id, { saved: true }) ?? draft;
  });
  if (created === null) throw new Error("the draft was never created");
  return created;
}

/** The last `command-request` this screen put on the wire, verbatim. */
function lastSent(stream: ReturnType<typeof mount>) {
  const sent = stream.transport.sentCommands;
  const last = sent[sent.length - 1];
  if (last === undefined) throw new Error("no command was sent");
  return last;
}

describe("PlanSlots", () => {
  it("says nothing has been read rather than showing an empty slot", async () => {
    mount();

    expect(screen.getByText("NO PLAN READING")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * Which of the ten, and how many there are. Every number the sections below
   * this one show belongs to whichever slot this names, and an operator reading
   * a plan they are not flying is the failure mode ten parallel plans creates.
   */
  it("names the selected slot against the count", async () => {
    const stream = mount();
    await emitPlan(stream);

    expect(screen.getByText("PLAN 1 OF 2")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The plan's extent as both quantities it is: an instant for where it begins,
   * an interval for how long it runs. `initialTimeUt` appears nowhere else on
   * the board.
   */
  it("shows where the plan begins and how long it runs", async () => {
    const stream = mount();
    await emitPlan(stream);

    expect(screen.getByText("PLAN STARTS")).toBeInTheDocument();
    expect(screen.getByText("PLAN RUNS FOR")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * Create is legal only where no plan exists, and the plugin refuses it by name
   * (`PlanAlreadyExists`) otherwise. A control that spent a delayed round trip
   * earning that refusal would have told the operator nothing until they tried.
   */
  it("offers no create for a vessel that already holds a plan", async () => {
    const stream = mount();
    await emitPlan(stream);

    expect(
      screen.queryByRole("button", {
        name: "Create a flight plan for this vessel",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete this flight plan" }),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The producer's "none selected" is minus one, so a slot badge for a craft
   * with no plan reads "PLAN 0 OF 0" beside the badge that says there is no
   * plan. One of the two says it; the other is noise.
   */
  it("says there is no plan rather than counting a slot that is not there", async () => {
    const stream = mount();
    await emitPlan(stream, {
      planExists: false,
      planCount: 0,
      selectedPlan: -1,
      burns: [],
    });

    expect(screen.getByText("NO PLAN ON THIS VESSEL")).toBeInTheDocument();
    expect(screen.queryByText(/^PLAN \d+ OF \d+$/)).not.toBeInTheDocument();
    await act(async () => {});
  });

  /** And the other half of the same rule. */
  it("offers create, and neither copy nor delete, for a vessel with no plan", async () => {
    const stream = mount();
    await emitPlan(stream, { planExists: false, planCount: 0, burns: [] });

    expect(
      screen.getByRole("button", {
        name: "Create a flight plan for this vessel",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete this flight plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Copy this flight plan into a new slot",
      }),
    ).not.toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * An eleventh plan makes Principia's own planner window throw on every layout
   * pass, with the button that would delete it inside the part that stopped
   * drawing. The count against the ceiling is the reading; the frozen copy is
   * what the reading means.
   */
  it("says the slots are full and freezes the copy at Principia's cap", async () => {
    const stream = mount();
    await emitPlan(stream, { planCount: 10, selectedPlan: 9 });

    expect(screen.getByText("SLOTS FULL AT 10")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Copy this flight plan into a new slot",
      }),
    ).toBeDisabled();
    await act(async () => {});
  });

  /**
   * The arm is the mod's precondition for every one of these writes, and the
   * sentence beside it is the mod's own rather than one composed here.
   */
  it("freezes every write until the surface is armed, and says why", async () => {
    const stream = mount();
    await emitPlan(stream, {
      writeSurface: {
        available: true,
        armed: false,
        reason: "Not armed. Arming runs a round trip of Principia's own burn.",
      },
    });

    expect(screen.getByText("NOT ARMED")).toBeInTheDocument();
    expect(
      await visibleText(screen.getByText("NOT ARMED").ownerDocument.body),
    ).toContain("Arming runs a round trip");
    expect(
      screen.getByRole("button", { name: "Delete this flight plan" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Copy this flight plan into a new slot",
      }),
    ).toBeDisabled();
    await act(async () => {});
  });

  /**
   * A running optimiser publishes a fresh candidate plan periodically and
   * Principia's own planner swaps it over the live one every frame, which
   * discards an in-place edit wholesale and reports nothing.
   */
  it("freezes the writes while Principia is optimising", async () => {
    const stream = mount();
    await emitPlan(stream, { optimisationRunning: true });

    expect(screen.getByText("OPTIMISING")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete this flight plan" }),
    ).toBeDisabled();
    await act(async () => {});
  });

  /**
   * What a delete costs, from the reading rather than from the press. A slot
   * holding burns is the one an operator most needs told before they confirm,
   * and the number is on the wire already.
   */
  it("says a delete takes the burns with it, and counts them", async () => {
    const stream = mount();
    await emitPlan(stream, { burns: [burn(), burn({ index: 1 })] });

    const body = screen.getByText("BURNS").ownerDocument.body;
    expect(await visibleText(body)).toContain(
      "Deleting this slot discards the burns above",
    );
    // The count is the BURNS row's, not a number repeated inside the sentence.
    expect(await visibleText(body)).toContain("BURNS2");
    await act(async () => {});
  });

  /**
   * A delete the mod answered from its own store is not a delete.
   *
   * The request id is composed from the vessel alone, so a second press after a
   * dropped reply sends the id the first one went under and the mod answers it
   * out of its replay cache without calling the plugin. Both resolve, so the
   * control cannot tell them apart; the receipt is the only place they differ.
   */
  it("says a delete answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "delete-vessel-1",
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this flight plan" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm deleting this flight plan" }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The RECEIPT READER, not the refusal path. See the sibling in `BurnEditor`
   * for the whole reasoning; the short version is that
   * `PlanCommands.Settle` answers every non-`Written` outcome with
   * `Success = false`, so the pairing scripted here is one the producer never
   * sends and the operator meets a refusal through the control instead. That is
   * the test below this one.
   */
  it("reads a non-Written outcome off the receipt itself, whatever the envelope claimed", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "delete-vessel-1",
        outcome: PrincipiaWriteOutcome.Refused,
        refusal: PrincipiaWriteRefusal.SurfaceUnavailable,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this flight plan" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm deleting this flight plan" }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    expect(screen.getByText(/SurfaceUnavailable/)).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The refusal path a delete actually takes, and the mod's own sentence
   * arriving at the operator on it.
   *
   * <p>`Settle` answers a refused delete with `Success = false`, the coarse
   * `Code(...)` for the guard, and `result.Detail` as the sentence. The spine
   * rejects on that, so `onConfirmed` never runs and there is no receipt banner
   * at all: the control is the whole surface. `detail` is the only clause
   * available here, because none of the ten ever sets a `LimitBreach`, so the
   * general clause for `WrongState` is what an operator saw until ui-kit stopped
   * dropping it.</p>
   */
  it("shows the mod's own sentence when a delete is refused", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() => ({
      success: false,
      errorCode: CommandErrorCode.WrongState,
      detail: "The vessel has no flight plan. Create one first.",
      payload: {
        requestId: "delete-vessel-1",
        replayed: false,
        outcome: PrincipiaWriteOutcome.Refused,
        refusal: PrincipiaWriteRefusal.NoFlightPlan,
        refusalDetail: "The vessel has no flight plan. Create one first.",
      },
    }));
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", { name: "Delete this flight plan" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm deleting this flight plan" }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Delete this flight plan refused: The vessel has no flight plan. Create one first.",
      }),
    ).toBeInTheDocument();
    // Not the general clause for the coarse code. That is what the operator got
    // while the refusal was rebuilt field by field without its `detail`.
    expect(
      screen.queryByRole("button", {
        name: /it is not in a state that allows it/,
      }),
    ).not.toBeInTheDocument();
    // And no receipt banner: a rejection never resolves, so `onConfirmed` never
    // ran and the widget was never handed a receipt to read.
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * A burn already running is a fact about the slot, not about the press, so it
   * is on screen before either control is touched.
   */
  it("says a burn is running", async () => {
    const stream = mount();
    await emitPlan(stream, { burns: [burn({ executing: true })] });

    expect(screen.getByText("A BURN IS RUNNING")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * A delete is legal at any instant, so this is reported rather than enforced:
   * the write can still land, it just lands after the burn the operator meant to
   * stop has lit. At a thirty-light-minute vantage the row saying so is itself
   * still an hour from telling them.
   */
  it("says when the next burn lights before a write could reach the craft", async () => {
    const stream = mount();
    act(() => {
      stream.emit("comms.delay", { oneWaySeconds: 1_800 });
    });
    await emitPlan(stream);

    expect(
      await visibleText(screen.getByText("BURNS").ownerDocument.body),
    ).toContain(
      "The next burn lights before a write sent now reaches Principia",
    );
    await act(async () => {});
  });

  it("says nothing about the next burn at a vantage with no delay", async () => {
    const stream = mount();
    await emitPlan(stream);

    expect(
      await visibleText(screen.getByText("BURNS").ownerDocument.body),
    ).not.toContain("The next burn lights before");
    await act(async () => {});
  });

  /**
   * The end instant is edited as a calendar date for the same reason a burn's
   * ignition is: one seconds box makes every edit an arithmetic problem about
   * how long a day is.
   */
  it("edits the plan's end as a calendar date", async () => {
    const stream = mount();
    await emitPlan(stream, { planExists: false, planCount: 0, burns: [] });

    for (const name of ["YEAR", "DAY", "HR", "MIN", "SEC"]) {
      expect(screen.getByLabelText(`New plan end ${name}`)).toBeInTheDocument();
    }
    await act(async () => {});
  });

  /**
   * Principia asserts on a plan that ends before it starts and takes the game
   * down rather than answering an error, so the bar is ARRIVAL: an end
   * comfortably ahead at the view instant can be behind by the time the create
   * lands.
   */
  it("refuses a create whose end has passed by the time it arrives", async () => {
    const stream = mount();
    act(() => {
      stream.emit("comms.delay", { oneWaySeconds: 1_800 });
    });
    await emitPlan(stream, { planExists: false, planCount: 0, burns: [] });

    const create = screen.getByRole("button", {
      name: "Create a flight plan for this vessel",
    });
    expect(create).toBeEnabled();

    // A day earlier than the seeded end, which puts it behind the arrival
    // instant two one-way delays out.
    await userEvent.click(
      screen.getByRole("button", { name: "New plan end earlier by 1d" }),
    );

    expect(create).toBeDisabled();
    expect(await visibleText(create.ownerDocument.body)).toContain(
      "has already passed by the time the write arrives",
    );
    await act(async () => {});
  });

  /**
   * The whole create, end to end.
   *
   * <p>The end instant is the panel's seeded one: two one-way light times past
   * the view instant, plus the default plan length. It is asserted as a NUMBER
   * because `PrincipiaPlanSlotArgs.finalTimeUt` is a plain double on the
   * receiving side, and it is in the request id because a create followed by a
   * delete followed by a create asking for the same end is genuinely the same
   * intent twice.</p>
   */
  it("creates a plan at the end instant on screen, and carries that instant in the id", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "create-vessel-1-13600",
        replayed: false,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream, { planExists: false, planCount: 0, burns: [] });

    await userEvent.click(
      screen.getByRole("button", {
        name: "Create a flight plan for this vessel",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm creating a flight plan for this vessel",
      }),
    );

    const sent = lastSent(stream);
    expect(sent.command).toBe("principia.plan.create");
    expect(sent.args).toEqual({
      vesselId: "vessel-1",
      requestId: "create-vessel-1-13600",
      finalTimeUt: VIEW_UT + 3600,
    });
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The replay arm on create. The id carries the vessel and the end instant and
   * nothing else, so create, delete, and create again asking for the same end
   * sends the id the first went under: the mod answers out of `_receipts` and
   * the vessel is left with no plan at all, which is the opposite of what the
   * control just confirmed.
   */
  it("says a create answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "create-vessel-1-13600",
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream, { planExists: false, planCount: 0, burns: [] });

    await userEvent.click(
      screen.getByRole("button", {
        name: "Create a flight plan for this vessel",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm creating a flight plan for this vessel",
      }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The whole copy, end to end. Duplicate acts on whichever plan is selected, so
   * the args are the vessel and the id and nothing more: the mod reads which
   * slot to copy off its own selection rather than off anything sent.
   */
  it("copies the selected slot, keyed on the count it was copied at", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "duplicate-vessel-1-2",
        replayed: false,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Copy this flight plan into a new slot",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm copying this flight plan into a new slot",
      }),
    );

    const sent = lastSent(stream);
    expect(sent.command).toBe("principia.plan.duplicate");
    expect(sent.args).toEqual({
      vesselId: "vessel-1",
      requestId: "duplicate-vessel-1-2",
    });
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The replay arm on copy, and the one where the key is weakest: the count is
   * read off a reading that is a light time old, so a second copy pressed before
   * the first one's new slot appears in a reading sends the same id, and the mod
   * answers it out of `_receipts` without making the second copy.
   */
  it("says a copy answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "duplicate-vessel-1-2",
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Copy this flight plan into a new slot",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm copying this flight plan into a new slot",
      }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * A composed plan reaches Principia's flight plan from here, and the composer
   * beside it writes stock manoeuvre nodes. An operator with nothing saved is
   * told which surface does which rather than shown an empty list.
   */
  it("says where a composed plan goes when none is saved", async () => {
    const stream = mount();
    await emitPlan(stream);

    expect(
      await visibleText(screen.getByText("BURNS").ownerDocument.body),
    ).toContain("No saved plan for this craft");
    await act(async () => {});
  });

  it("offers a saved plan for installation, and says what it replaces", async () => {
    const stream = mount();
    saveDraft(stream.store);
    await emitPlan(stream);

    expect(
      screen.getByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    ).toBeEnabled();
    expect(
      await visibleText(screen.getByText("SAVED PLAN 1").ownerDocument.body),
    ).toContain("overwrites the burns the slot holds now");
    await act(async () => {});
  });

  /**
   * The whole install, end to end: the press, the args the mod binds, and the
   * receipt read back off the reply.
   *
   * <p><b>The burns carry plain numbers, and that is the assertion.</b>
   * `PrincipiaComposedBurn` is a payload carried INSIDE an args record rather
   * than an args record itself, so codegen's "an Args type is a wire-WRITE"
   * exemption does not reach it and its instants and components are generated as
   * `Value`s. A draft holds them that way too, because a draft is read and
   * rendered. But `ChannelEngine.BindCommandArgs` binds each to a plain
   * <c>double</c> and rejects an object bag outright: "Cannot bind wire value of
   * type Dictionary to numeric Double", thrown from INSIDE the handler, which
   * loses the whole plan rather than one field. The sdk's own `planSendArgs`
   * unwraps for exactly this reason and says so at length.</p>
   */
  it("sends the composed plan as the numbers the mod binds, not as unit values", async () => {
    const stream = mount();
    const draft = saveDraft(stream.store);
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: `send-${draft.id}@${draft.revision}-110000`,
        replayed: false,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm installing this plan as Principia's flight plan",
      }),
    );

    const sent = lastSent(stream);
    expect(sent.command).toBe("principia.plan.send");
    expect(sent.args).toEqual({
      vesselId: "vessel-1",
      // The draft's CONTENT at its revision, plus the end instant, which is
      // stated by the panel rather than by the draft and so has to join the key.
      requestId: `send-${draft.id}@${draft.revision}-110000`,
      composedAtViewUt: VIEW_UT,
      observedAtUt: VIEW_UT,
      desiredFinalTimeUt: 110_000,
      burns: [
        {
          ignitionUt: VIEW_UT + 7200,
          // Slot for slot, in the basis's own order: the draft's first slot is
          // the TANGENT under `TangentNormalBinormal`, whatever its field is
          // called. Labelling by field name puts an along-track burn out of
          // plane.
          deltaVTangent: 120,
          deltaVNormal: 0,
          deltaVBinormal: 0,
          inertiallyFixed: false,
          profile: PrincipiaBurnProfile.Unchanged,
        },
      ],
    });
    // A `Written` receipt that was not replayed is a write, and the banner that
    // contradicts the control must stay off for it.
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The replay arm on the newest of the ten. This id is the best-composed of the
   * family (content plus revision plus the end instant), so a repeat is a
   * genuine retransmission rather than an edit that lost its key: the mod
   * answers it out of `_receipts` and the plan aboard is whatever the first one
   * put there.
   */
  it("says an install answered from an earlier receipt changed nothing", async () => {
    const stream = mount();
    const draft = saveDraft(stream.store);
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: `send-${draft.id}@${draft.revision}-110000`,
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );
    await emitPlan(stream);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm installing this plan as Principia's flight plan",
      }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * An arm is not a burn verdict, and INSTALL needs the verdict WHEN THE SLOT
   * ALREADY HOLDS BURNS.
   *
   * `PlanCommands.SendPlan` gates on `gate.ManoeuvreCount() > 0 &&
   * !BurnLayoutVerified` and says why it does not gate on it otherwise: a plan
   * sent to a craft holding none builds its head burn, and that build is its own
   * demonstration of the struct. So the same unverified surface blocks an
   * install onto a slot with burns and permits one onto a slot without.
   */
  it("freezes an install onto a slot holding burns when the burn struct was never verified", async () => {
    const stream = mount();
    saveDraft(stream.store);
    await emitPlan(stream, {
      writeSurface: {
        available: true,
        armed: true,
        burnLayoutVerified: false,
        integratorLayoutVerified: true,
        reason: null,
        analysedVersion: "analysed",
        detectedVersion: "analysed",
      },
    });

    expect(
      screen.getByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(/this slot already holds burns to copy from/),
    ).toBeInTheDocument();
    await act(async () => {});
  });

  it("offers an install onto a slot with no burns even when the burn struct was never verified", async () => {
    const stream = mount();
    saveDraft(stream.store);
    await emitPlan(stream, {
      burns: [],
      writeSurface: {
        available: true,
        armed: true,
        burnLayoutVerified: false,
        integratorLayoutVerified: true,
        reason: null,
        analysedVersion: "analysed",
        detectedVersion: "analysed",
      },
    });

    expect(
      screen.getByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    ).toBeEnabled();
    await act(async () => {});
  });

  /** A draft for another craft is not this slot's business. */
  it("offers no plan saved for a different vessel", async () => {
    const stream = mount();
    saveDraft(stream.store, { vesselId: "vessel-2" });
    await emitPlan(stream);

    expect(
      screen.queryByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    ).not.toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The same three numbers are a different manoeuvre in each basis. Principia's
   * burns are the Frenet trihedron, so a plan composed in KSP's
   * radial/normal/prograde basis is refused rather than reinterpreted: sending it
   * would put an operator's along-track burn out of plane, which is a wrong burn
   * that reads as a right one.
   */
  it("refuses to install a plan composed in the stock basis", async () => {
    const stream = mount();
    saveDraft(stream.store, { frame: ManeuverFrame.RadialNormalPrograde });
    await emitPlan(stream);

    expect(
      screen.getByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    ).toBeDisabled();
    expect(
      await visibleText(screen.getByText("SAVED PLAN 1").ownerDocument.body),
    ).toContain("cannot be installed as it stands");
    await act(async () => {});
  });

  /**
   * The mod refuses the WHOLE plan when any burn has ignited by arrival, rather
   * than installing the ones still ahead, so the deadline is worth reading before
   * the press.
   */
  it("refuses to install a plan whose first burn lights before it could arrive", async () => {
    const stream = mount();
    saveDraft(stream.store, { ignitionUt: VIEW_UT + 600 });
    act(() => {
      stream.emit("comms.delay", { oneWaySeconds: 1_800 });
    });
    await emitPlan(stream);

    expect(
      screen.getByRole("button", {
        name: "Install this plan as Principia's flight plan",
      }),
    ).toBeDisabled();
    expect(
      await visibleText(screen.getByText("SAVED PLAN 1").ownerDocument.body),
    ).toContain("refuses the whole plan");
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const stream = mount();
    saveDraft(stream.store);
    await emitPlan(stream);

    await expectNoA11yViolations(stream.container);
    await act(async () => {});
  });
});
