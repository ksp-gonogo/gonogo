import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { PrincipiaPlan } from "../__generated__/contract";
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

function plan(overrides: Partial<PrincipiaPlan> = {}): PrincipiaPlan {
  return {
    vesselId: "vessel-1",
    sampledAtUt: VIEW_UT,
    planExists: true,
    desiredFinalTimeUt: VIEW_UT + 144_000,
    actualFinalTimeUt: VIEW_UT + 144_000,
    integrator: {
      maxSteps: 1024,
      lengthToleranceMetres: 1,
      speedToleranceMetresPerSecond: 1,
    },
    ...overrides,
  } as PrincipiaPlan;
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

  it("has no accessibility violations", async () => {
    const { container } = mount(plan());
    expect(await axe(container)).toHaveNoViolations();
  });
});
