import {
  type OrbitTrajectory,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-client";
import { render } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  TrajectoryWithheldNote,
  trajectoryWithheldCopy,
} from "./trajectoryWithheld";

/** Every reason the seam can hand back, listed so a new one cannot slip past unworded. */
const EVERY_REASON = [
  "no-horizon-stated",
  "past-horizon",
  "shape-not-stated",
  "no-arc-available",
  "beyond-budget",
  "no-force-model",
] as const satisfies readonly Extract<
  OrbitTrajectory,
  { shape: "withheld" }
>["reason"][];

describe("trajectoryWithheldCopy", () => {
  it("gives every reason its own sentence, never a shared one", () => {
    // Two refusals sharing a heading is the failure this table exists to stop:
    // an operator reading the same words for a missing install and for an
    // outrun horizon acts on the wrong one of them.
    const headings = EVERY_REASON.map(
      (reason) => trajectoryWithheldCopy({ shape: "withheld", reason }).heading,
    );
    expect(new Set(headings).size).toBe(EVERY_REASON.length);
    const details = EVERY_REASON.map(
      (reason) => trajectoryWithheldCopy({ shape: "withheld", reason }).detail,
    );
    expect(new Set(details).size).toBe(EVERY_REASON.length);
  });

  it("tells the operator to shorten the window when the budget ran out", () => {
    const { heading, detail } = trajectoryWithheldCopy({
      shape: "withheld",
      reason: "beyond-budget",
    });
    expect(heading).toBe("BEYOND BUDGET");
    expect(detail).toMatch(/shorten the window/i);
  });

  it("names a missing force model as an install problem, with no wait in it", () => {
    // The one refusal with no operator remedy. Telling someone to wait for it
    // would have them waiting for a curve that is never coming.
    const { heading, detail } = trajectoryWithheldCopy({
      shape: "withheld",
      reason: "no-force-model",
    });
    expect(heading).toBe("NO FORCE MODEL");
    expect(detail).toMatch(/install/i);
    expect(detail).not.toMatch(/\bwait\b/i);
  });

  it("still separates an outrun integration from an outrun conic", () => {
    expect(
      trajectoryWithheldCopy({
        shape: "withheld",
        reason: "past-horizon",
        trajectoryKind: TrajectoryKindLike.Integrated,
      }).heading,
    ).toBe("BEYOND INTEGRATION");
    expect(
      trajectoryWithheldCopy({
        shape: "withheld",
        reason: "past-horizon",
        trajectoryKind: TrajectoryKindLike.Analytic,
      }).heading,
    ).toBe("PAST HORIZON");
  });
});

describe("TrajectoryWithheldNote", () => {
  it("puts the new refusals on screen where the drawing was", () => {
    const { container } = render(
      <TrajectoryWithheldNote
        withheld={{ shape: "withheld", reason: "no-force-model" }}
      />,
    );
    expect(visibleText(container)).toContain("NO FORCE MODEL");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <TrajectoryWithheldNote
        withheld={{ shape: "withheld", reason: "beyond-budget" }}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
