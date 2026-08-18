import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { Badge } from "@ksp-gonogo/ui-kit";
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

  it("is an INSTANTANEOUS flag: it can fire before the mod's own issue string catches up", () => {
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
    // Kerbalism halts food production the instant ambient exceeds
    // tolerance (see GreenhouseSection's own doc comment, grounded against
    // Greenhouse.cs), so the row never claims "Growing" while this flag is
    // up, even if the mod's own `issue` field hasn't reported it yet: that
    // exact contradiction was the operator-reported bug this reconciles.
    expect(screen.queryByText("Growing")).not.toBeInTheDocument();
    expect(screen.getByText("Halted")).toBeInTheDocument();
    expect(screen.getByText("Radiation too high")).toBeInTheDocument();
  });

  it("uses warning severity, not critical, for the radiation-too-high badge", () => {
    renderSection([row({ radiationToleranceRadPerSec: 0.001 })], 0.005);
    const badgeClass = screen.getByText("Radiation too high").className;
    // Severity drives styled-components' generated class, not an inline
    // style (`toHaveStyle` can't see a `var()`-based rule, same jsdom gap
    // Card's own tone tests document); comparing classes against reference
    // `Badge` instances at each severity is the same technique
    // `Badge.test.tsx`'s own "applies a different class for different
    // tones" case already uses.
    const { unmount: unmountWarning } = render(
      <Badge severity="warning" size="sm">
        ref
      </Badge>,
    );
    const warningClass = screen.getByText("ref").className;
    unmountWarning();
    const { unmount: unmountCritical } = render(
      <Badge severity="critical" size="sm">
        ref
      </Badge>,
    );
    const criticalClass = screen.getByText("ref").className;
    unmountCritical();

    expect(badgeClass).toBe(warningClass);
    expect(badgeClass).not.toBe(criticalClass);
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
