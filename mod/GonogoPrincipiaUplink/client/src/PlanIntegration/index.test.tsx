import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PrincipiaPlan,
  PrincipiaPlannedBurn,
} from "../__generated__/contract";
import { axe } from "../test/axe";
import { MAX_STEPS_OPTIONS, PlanIntegrationBlock } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const VIEW_UT = 1_000_000;

/**
 * Rendered from a plain payload rather than through the stream.
 *
 * <p>This block takes its plan as a prop from the section around it, so a stream
 * fixture would be exercising that section's reading rather than this block's
 * decisions. What is under test here is which numbers appear and what the
 * control offers.</p>
 */
function mount(plan: PrincipiaPlan | null) {
  const result = render(<PlanIntegrationBlock plan={plan} />);
  renderedTrees.push(result.unmount);
  return result;
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
    writeSurface: { available: true, armed: true },
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

  it("has no accessibility violations", async () => {
    const { container } = mount(plan());
    expect(await axe(container)).toHaveNoViolations();
  });
});
