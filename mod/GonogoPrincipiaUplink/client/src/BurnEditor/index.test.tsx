import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { BurnEditor } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const VIEW_UT = 10_000;

const CARRIED = ["principia.plan"];

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

  it("says a plan with no burns cannot have one added from here", async () => {
    const stream = mount();
    await emitPlan(stream, { burns: [] });

    expect(screen.getByText(/copies an existing burn/)).toBeInTheDocument();
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

  it("has no accessibility violations", async () => {
    const stream = mount();
    await emitPlan(stream);

    await userEvent.click(screen.getByRole("button", { name: "Burn 1" }));
    await axe(stream.container);
  });
});
