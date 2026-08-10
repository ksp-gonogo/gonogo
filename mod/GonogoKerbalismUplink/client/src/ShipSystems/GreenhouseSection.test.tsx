import { render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
// Importing the real module runs its module-load registerAugment(...).
import {
  type GreenhouseRow,
  GreenhouseSection,
  radiationTooHigh,
} from "./GreenhouseSection";

function row(overrides: Partial<GreenhouseRow> = {}): GreenhouseRow {
  return {
    cropResource: "Food",
    natural: 300,
    artificial: 0,
    active: true,
    issue: "",
    foodRatePerSec: 0.0001,
    radiationToleranceRadPerSec: 0,
    ...overrides,
  };
}

describe("radiationTooHigh", () => {
  it("never flags an unreported tolerance (<= 0)", () => {
    expect(radiationTooHigh(row({ radiationToleranceRadPerSec: 0 }), 999)).toBe(
      false,
    );
  });

  it("never flags when there is no ambient reading yet", () => {
    expect(
      radiationTooHigh(row({ radiationToleranceRadPerSec: 0.001 }), 0),
    ).toBe(false);
  });

  it("flags once ambient exceeds the part's own tolerance", () => {
    expect(
      radiationTooHigh(row({ radiationToleranceRadPerSec: 0.001 }), 0.002),
    ).toBe(true);
  });

  it("stays quiet while ambient is under tolerance", () => {
    expect(
      radiationTooHigh(row({ radiationToleranceRadPerSec: 0.001 }), 0.0005),
    ).toBe(false);
  });
});

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function renderSection(
  greenhouses: readonly GreenhouseRow[],
  ambientRadiationRadPerSecond: number,
) {
  const result = render(
    <GreenhouseSection
      greenhouses={greenhouses}
      ambientRadiationRadPerSecond={ambientRadiationRadPerSecond}
    />,
  );
  renderedTrees.push(result.unmount);
  return result;
}

describe("GreenhouseSection: radiation-too-high badge", () => {
  it("shows the badge when ambient exceeds the greenhouse's own tolerance", () => {
    renderSection(
      [row({ radiationToleranceRadPerSec: 0.002 })],
      0.006, // well above tolerance
    );
    expect(screen.getByText("Radiation too high")).toBeInTheDocument();
  });

  it("omits the badge when ambient is under tolerance", () => {
    renderSection([row({ radiationToleranceRadPerSec: 0.01 })], 0.002);
    expect(screen.queryByText("Radiation too high")).not.toBeInTheDocument();
  });

  it("omits the badge when the part reports no tolerance at all", () => {
    renderSection([row({ radiationToleranceRadPerSec: 0 })], 999);
    expect(screen.queryByText("Radiation too high")).not.toBeInTheDocument();
  });

  it("is an INSTANTANEOUS flag: it can fire on an otherwise-healthy, unblocked greenhouse", () => {
    renderSection(
      [
        row({
          issue: "",
          active: true,
          radiationToleranceRadPerSec: 0.001,
        }),
      ],
      0.005,
    );
    expect(screen.getByText("Growing")).toBeInTheDocument();
    expect(screen.getByText("Radiation too high")).toBeInTheDocument();
  });

  it("threads the check through the multi-greenhouse path too", () => {
    renderSection(
      [
        row({ cropResource: "Food", radiationToleranceRadPerSec: 0.001 }),
        row({ cropResource: "Mystery Goo", radiationToleranceRadPerSec: 0.01 }),
      ],
      0.005,
    );
    expect(screen.getByText("Radiation too high")).toBeInTheDocument();
    // Only one of the two crops crosses its own tolerance.
    expect(screen.getAllByText("Radiation too high")).toHaveLength(1);
  });

  it("has no axe violations with the badge showing", async () => {
    const { container } = renderSection(
      [row({ radiationToleranceRadPerSec: 0.001 })],
      0.005,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
