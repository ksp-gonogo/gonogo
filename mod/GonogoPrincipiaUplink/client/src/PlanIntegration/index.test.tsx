import { CommandErrorCode } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PrincipiaPlan,
  PrincipiaPlannedBurn,
} from "../__generated__/contract";
import {
  PrincipiaWriteOutcome,
  PrincipiaWriteRefusal,
} from "../__generated__/contract";
import { axe } from "../test/axe";
import { MAX_STEPS_OPTIONS, PlanIntegrationBlock } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const VIEW_UT = 1_000_000;

// `comms.delay` is carried because it is what `useCommand` reads its one-way
// delay off, and both controls here freeze on a delay-aware handle. A fixture
// that left it out would report every vantage as instant.
const CARRIED = ["principia.plan", "comms.delay"];

/**
 * A plan write's answer as the mod actually sends it: a `CommandResult` whose
 * `payload` is the receipt. See `JsonWriter.AppendCommandResult`, and
 * `PlanCommands.Settle`/`Ok`, which is what puts the receipt there.
 */
function planWriteReply(receipt: Record<string, unknown>) {
  return { success: true, errorCode: 0, payload: receipt };
}

/**
 * Rendered from a plain payload rather than through the stream.
 *
 * <p>This block takes its plan as a prop from the section around it, so a stream
 * fixture would be exercising that section's reading rather than this block's
 * decisions. What is under test here is which numbers appear and what the
 * control offers.</p>
 *
 * <p>The stream is here anyway, and only for the two CommandButtons: they
 * dispatch through a real handle, so the receipt a write comes back with is
 * reachable only from inside a provider.</p>
 */
function mount(plan: PrincipiaPlan | null) {
  const stream = setupStreamFixture({ carriedChannels: CARRIED });
  const result = render(
    <stream.Provider>
      <PlanIntegrationBlock plan={plan} />
    </stream.Provider>,
  );
  renderedTrees.push(result.unmount);
  return { ...stream, ...result };
}

/**
 * A plan with the write surface ARMED, because both controls in this block are
 * frozen without one and the mod refuses either by name. A fixture that left it
 * out would exercise the read-only rendering while reading as the ordinary case.
 */
function plan(overrides: Partial<PrincipiaPlan> = {}): PrincipiaPlan {
  return {
    vesselId: "vessel-1",
    sampledAtUt: VIEW_UT,
    planExists: true,
    initialTimeUt: VIEW_UT,
    desiredFinalTimeUt: VIEW_UT + 144_000,
    actualFinalTimeUt: VIEW_UT + 144_000,
    // Both verdicts STATED. `armed` and `integratorLayoutVerified` are
    // independent on the wire, and the step-limit write is the one the second
    // gates: `PlanCommands.SetIntegrator` refuses `LayoutUnverified` on it
    // whatever the arm says. A fixture omitting the field leaves it
    // `undefined`, which is neither verdict.
    writeSurface: {
      available: true,
      armed: true,
      burnLayoutVerified: true,
      integratorLayoutVerified: true,
    },
    integrator: {
      maxSteps: 1024,
      lengthToleranceMetres: 1,
      speedToleranceMetresPerSecond: 1,
    },
    burns: [],
    ...overrides,
  } as PrincipiaPlan;
}

/**
 * One burn in the plan, for the row that counts what a shorter plan drops.
 *
 * <p>Bare numbers where the payload declares `Value`s, the same way `plan()`
 * above does: this block renders from a prop rather than through the stream, so
 * nothing has hydrated the units and `magnitudeOf` reads either shape.</p>
 */
function burn(ignitionUt: number, index = 0): PrincipiaPlannedBurn {
  return { index, ignitionUt, deltaV: 120 } as unknown as PrincipiaPlannedBurn;
}

describe("PlanIntegrationBlock", () => {
  it("renders nothing at all without a plan to bound", () => {
    const { container } = mount(null);
    expect(container.textContent).toBe("");
  });

  /**
   * The pair is the point. A plan that stopped short of where it was asked to
   * end is a plan in trouble, and neither instant alone says so.
   */
  it("says how far short a truncated plan stopped", async () => {
    const { container } = mount(
      plan({ actualFinalTimeUt: (VIEW_UT + 100_000) as never }),
    );
    expect(await visibleText(container)).toContain(
      "short of the requested end",
    );
  });

  it("says nothing about a shortfall when the plan reached its end", async () => {
    const { container } = mount(plan());
    expect(await visibleText(container)).not.toContain(
      "short of the requested",
    );
  });

  /**
   * The step count is a closed set of eight, so the control over it steps
   * through that set. A free numeric field would let an operator send a value
   * the producer's own write gate refuses.
   */
  it("steps through the producer's own eight step counts", async () => {
    mount(plan());
    const spin = screen.getByRole("spinbutton", {
      name: "Max integration steps per segment",
    });
    expect(spin).toHaveAttribute("aria-valuetext", "1,024");
    expect(spin).toHaveAttribute(
      "aria-valuemax",
      String(MAX_STEPS_OPTIONS.length - 1),
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Increase Max integration steps per segment",
      }),
    );
    expect(spin).toHaveAttribute("aria-valuetext", "4,096");
  });

  /**
   * Sending the value the plan already holds is a delayed round trip that
   * changes nothing, so the control that dispatches it stays inert until the
   * operator has actually moved the number.
   */
  it("offers no dispatch until the step count has been moved", async () => {
    mount(plan());
    expect(
      screen.getByRole("button", { name: "Set the flight plan's step limit" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", {
        name: "Increase Max integration steps per segment",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Set the flight plan's step limit" }),
    ).toBeEnabled();
  });

  /**
   * An arm is not a step-parameter verdict, and the step-limit write needs the
   * verdict.
   *
   * `PlanCommands.SetIntegrator` refuses `LayoutUnverified` whenever
   * `IntegratorLayoutVerified` is false, whatever the arm says, and that state
   * is reachable beside `armed: true`: `PrincipiaLayoutProbe.Run` records both
   * verdicts and returns null whatever they were, and `Arm` refuses only when
   * NEITHER struct survived. The end instant is NOT gated with it, because
   * `SetHorizon` writes no step parameters and takes no verdict.
   */
  it("freezes the step limit when the step parameters were never verified", async () => {
    mount(
      plan({
        writeSurface: {
          available: true,
          armed: true,
          burnLayoutVerified: true,
          integratorLayoutVerified: false,
        },
      }),
    );

    // Both remedies moved off the value the plan holds, since neither control
    // dispatches an unchanged one. What separates them here is the verdict.
    await userEvent.click(
      screen.getByRole("button", {
        name: "Increase Max integration steps per segment",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Plan end later by 1h" }),
    );

    expect(
      screen.getByRole("button", { name: "Set the flight plan's step limit" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Move the flight plan's end instant",
      }),
    ).toBeEnabled();
    expect(
      screen.getByText(/step parameters have not survived a round trip/),
    ).toBeInTheDocument();
  });

  /**
   * The plan's end and its step budget are the only two answers to a plan that
   * stopped short, so they are one block. Split across panels and an operator
   * finds one of the two.
   */
  it("offers the plan's end as the other remedy, beside the step budget", async () => {
    mount(plan());

    expect(
      screen.getByRole("button", {
        name: "Move the flight plan's end instant",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Plan end YEAR")).toBeInTheDocument();
  });

  /** Sending the end the plan already holds is a delayed round trip that
   *  changes nothing. */
  it("offers no dispatch until the end instant has been moved", async () => {
    mount(plan());
    const set = screen.getByRole("button", {
      name: "Move the flight plan's end instant",
    });
    expect(set).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "Plan end later by 1h" }),
    );
    expect(set).toBeEnabled();
  });

  /**
   * The trap Principia's own doc names: shortening the plan makes every burn
   * beyond the new end vanish, the write reports success, and a burn that
   * disappeared reads exactly like a burn that was deleted. Said before the
   * press, off the burn list this block already holds.
   */
  it("counts the burns a shorter plan would drop", async () => {
    const { container } = mount(
      plan({
        burns: [
          burn(VIEW_UT + 1_000),
          burn(VIEW_UT + 100_000, 1),
          burn(VIEW_UT + 130_000, 2),
        ],
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Plan end earlier by 1d" }),
    );

    expect(await visibleText(container)).toContain("BURNS DROPPED1");
    expect(await visibleText(container)).toContain(
      "Every burn igniting at or after this end is removed",
    );
  });

  /**
   * Both controls, on the mod's own precondition. Every plan write is persisted
   * into the player's save and re-integrates on the game's own thread, so it
   * takes an arm first; a control that spent a delay round trip to be told that
   * would be telling the operator nothing until they tried.
   */
  it("freezes both remedies until the write surface is armed", async () => {
    mount(
      plan({
        writeSurface: {
          available: true,
          armed: false,
          reason:
            "Not armed. Arming runs a round trip of Principia's own burn.",
        },
      }),
    );

    expect(
      screen.getByRole("button", { name: "Set the flight plan's step limit" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Move the flight plan's end instant",
      }),
    ).toBeDisabled();
    /*
     * `aria-disabled`, not `disabled`: the kit keeps a dark control in the
     * assistive-technology walk so an operator using one finds it where a
     * sighted operator sees it.
     */
    expect(
      screen.getByRole("spinbutton", {
        name: "Max integration steps per segment",
      }),
    ).toHaveAttribute("aria-disabled", "true");
    // The mod's own sentence, passed through rather than reworded.
    expect(await visibleText(document.body)).toContain(
      "Arming runs a round trip",
    );
  });

  /**
   * The other half of the same gate, and the one an arm badge cannot show: a
   * write made while Principia is optimising is reverted without being
   * reported, because the optimiser publishes a fresh candidate plan and the
   * producer's own planner swaps it over the live one every frame.
   */
  it("freezes both remedies while Principia is optimising", async () => {
    const { container } = mount(plan({ optimisationRunning: true }));

    expect(
      screen.getByRole("button", { name: "Set the flight plan's step limit" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Move the flight plan's end instant",
      }),
    ).toBeDisabled();
    expect(await visibleText(container)).toContain(
      "Principia is optimising this plan",
    );
  });

  /**
   * A step limit the mod answered from its own store is not a step limit.
   *
   * The request id is composed from the vessel and the CHOSEN count, so an
   * operator who steps to 4096, sends it, steps away and steps back sends the id
   * the first press went under, and `PlanCommands.SetIntegrator` answers it out
   * of `_receipts` before it reaches the plugin. Both resolve, so the control
   * cannot tell them apart; the receipt is the only place they differ.
   */
  it("says a step-limit write answered from an earlier receipt changed nothing", async () => {
    const stream = mount(plan());
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "integrator-vessel-1-4096",
        replayed: true,
        outcome: PrincipiaWriteOutcome.Written,
        refusal: PrincipiaWriteRefusal.NotRefused,
      }),
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Increase Max integration steps per segment",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Set the flight plan's step limit" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm setting the flight plan's step limit",
      }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The RECEIPT READER on the other remedy, and not the refusal path.
   *
   * <p>The other way a receipt can report a write that did not happen: an
   * outcome that is not `Written`, whatever the envelope around it said.
   * `PlanCommands.Settle` answers every non-`Written` outcome with
   * `Success = false`, so this pairing is one the producer never sends, and the
   * banner asserted here can only fire on the REPLAY arm in production. What an
   * operator meets on a real refusal is the test below.</p>
   */
  it("reads a non-Written end-instant outcome off the receipt itself, whatever the envelope claimed", async () => {
    const stream = mount(plan());
    stream.transport.setCommandHandler(() =>
      planWriteReply({
        requestId: "horizon-vessel-1-1144000",
        outcome: PrincipiaWriteOutcome.Refused,
        refusal: PrincipiaWriteRefusal.SurfaceUnavailable,
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Plan end later by 1h" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Move the flight plan's end instant",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm moving the flight plan's end instant",
      }),
    );

    expect(await screen.findByText("NOTHING WAS WRITTEN")).toBeInTheDocument();
    expect(screen.getByText(/SurfaceUnavailable/)).toBeInTheDocument();
    await act(async () => {});
  });

  /**
   * The refusal path the end instant actually takes, with the mod's own
   * sentence on it.
   *
   * <p>`Settle` answers a refused horizon write with `Success = false`, the
   * coarse code for the guard and `result.Detail` as the sentence. The spine
   * rejects, `onConfirmed` never runs, and the control is the whole surface: no
   * receipt banner, and the button's accessible name is what the mod said.
   * `FinalTimeInPast` maps onto `Range`, whose general clause is "an argument
   * was outside its valid range", which is what the operator got while ui-kit
   * was rebuilding the refusal without copying `detail`.</p>
   */
  it("shows the mod's own sentence when the end instant is refused", async () => {
    const stream = mount(plan());
    const said =
      "The plan cannot be asked to end before the instant it starts from";
    stream.transport.setCommandHandler(() => ({
      success: false,
      errorCode: CommandErrorCode.Range,
      detail: said,
      payload: {
        requestId: "horizon-vessel-1-1144000",
        replayed: false,
        outcome: PrincipiaWriteOutcome.Refused,
        refusal: PrincipiaWriteRefusal.FinalTimeInPast,
        refusalDetail: said,
      },
    }));

    await userEvent.click(
      screen.getByRole("button", { name: "Plan end later by 1h" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Move the flight plan's end instant",
      }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirm moving the flight plan's end instant",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: `Move the flight plan's end instant refused: ${said}.`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /an argument was outside its valid range/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("NOTHING WAS WRITTEN")).not.toBeInTheDocument();
    await act(async () => {});
  });

  it("has no accessibility violations", async () => {
    const { container } = mount(plan());
    expect(await axe(container)).toHaveNoViolations();
  });
});
