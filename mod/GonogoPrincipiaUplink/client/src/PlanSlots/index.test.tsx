import type { PlanDraftStore } from "@ksp-gonogo/sitrep-sdk";
import { ManeuverFrame, usePlanDrafts, value } from "@ksp-gonogo/sitrep-sdk";
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
import { PlanSlots } from "./index";

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
      reason: null,
      analysedVersion: "analysed",
      detectedVersion: "analysed",
    },
    burns: [burn()],
    ...overrides,
  };
}

/** A saved draft for the plan's own vessel, which is what INSTALL offers. */
function saveDraft(
  store: PlanDraftStore,
  overrides: {
    frame?: ManeuverFrame;
    ignitionUt?: number;
    vesselId?: string;
  } = {},
) {
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
    store.update(draft.id, { saved: true });
  });
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
