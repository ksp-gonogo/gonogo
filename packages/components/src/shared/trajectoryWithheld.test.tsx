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
] as const satisfies readonly Extract<
  OrbitTrajectory,
  { shape: "withheld" }
>["reason"][];

describe("trajectoryWithheldCopy", () => {
  it("gives every reason its own sentence, never a shared one", () => {
    // Refusals sharing words would send an operator after the wrong remedy.
    const headings = EVERY_REASON.map(
      (reason) => trajectoryWithheldCopy({ shape: "withheld", reason }).heading,
    );
    expect(new Set(headings).size).toBe(EVERY_REASON.length);
    const details = EVERY_REASON.map(
      (reason) => trajectoryWithheldCopy({ shape: "withheld", reason }).detail,
    );
    expect(new Set(details).size).toBe(EVERY_REASON.length);
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
  it("puts the refusal on screen where the drawing was", () => {
    const { container } = render(
      <TrajectoryWithheldNote
        withheld={{ shape: "withheld", reason: "shape-not-stated" }}
      />,
    );
    expect(visibleText(container)).toContain("SHAPE NOT STATED");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <TrajectoryWithheldNote
        withheld={{ shape: "withheld", reason: "no-arc-available" }}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
