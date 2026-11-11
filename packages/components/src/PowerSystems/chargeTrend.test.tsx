import { value } from "@ksp-gonogo/sitrep-sdk";
import "./chargeRate";
import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ChargeTrendBox, chargeTrendBadges } from "./ChargeTrendBox";
import { chargeTrend, smoothStep } from "./chargeTrend";

describe("chargeTrend", () => {
  it("is absent while there is no rate, stored amount or capacity", () => {
    expect(chargeTrend(undefined, 100, 200)).toBeUndefined();
    expect(chargeTrend(-1, undefined, 200)).toBeUndefined();
    expect(chargeTrend(-1, 100, undefined)).toBeUndefined();
    expect(chargeTrend(Number.NaN, 100, 200)).toBeUndefined();
  });

  it("gives the time to empty while draining and the time to full while charging", () => {
    expect(chargeTrend(-2, 100, 200)).toMatchObject({
      direction: "draining",
      secondsToEmpty: 50,
      secondsToFull: undefined,
    });
    expect(chargeTrend(4, 100, 200)).toMatchObject({
      direction: "charging",
      secondsToFull: 25,
      secondsToEmpty: undefined,
    });
  });

  it("gives no time when level or already at the limit", () => {
    expect(chargeTrend(0.004, 100, 200)).toMatchObject({
      direction: "steady",
      secondsToEmpty: undefined,
      secondsToFull: undefined,
    });
    expect(chargeTrend(3, 200, 200)).toMatchObject({
      direction: "charging",
      secondsToFull: undefined,
      atLimit: true,
    });
    expect(chargeTrend(-2, 0, 200)).toMatchObject({
      direction: "draining",
      secondsToEmpty: undefined,
      atLimit: true,
    });
  });
});

describe("smoothStep", () => {
  it("holds with no time passed and approaches the target as time passes", () => {
    expect(smoothStep(-1, -5, 0)).toBe(-1);
    const later = smoothStep(-1, -5, 8);
    expect(later).toBeLessThan(-2);
    expect(later).toBeGreaterThan(-5);
  });
});

describe("ChargeTrendBox", () => {
  const none = { secondsToEmpty: undefined, secondsToFull: undefined };

  it("draws nothing with no trend", () => {
    expect(
      render(<ChargeTrendBox trend={undefined} />).container.textContent,
    ).toBe("");
  });

  it("shows the time to empty while draining", () => {
    render(
      <ChargeTrendBox
        trend={{
          ...none,
          direction: "draining",
          secondsToEmpty: 436,
          atLimit: false,
        }}
      />,
    );
    expect(screen.getByText(/empty in/).textContent).toContain("7min 16s");
  });

  it("shows the time to full while charging", () => {
    render(
      <ChargeTrendBox
        trend={{
          ...none,
          direction: "charging",
          secondsToFull: 90,
          atLimit: false,
        }}
      />,
    );
    expect(screen.getByText(/full in/).textContent).toContain("1min 30s");
  });

  it("says holding when level and full when already full, with no time", () => {
    const { container, rerender } = render(
      <ChargeTrendBox
        trend={{ ...none, direction: "steady", atLimit: false }}
      />,
    );
    expect(container.textContent).toContain("holding");
    rerender(
      <ChargeTrendBox
        trend={{ ...none, direction: "charging", atLimit: true }}
      />,
    );
    expect(container.textContent).not.toContain(" in ");
    expect(container.textContent).toContain("full");
  });
});

describe("chargeTrendBadges", () => {
  const none = { secondsToEmpty: undefined, secondsToFull: undefined };

  it("is absent with no trend", () => {
    expect(chargeTrendBadges(undefined)).toBeUndefined();
  });

  it("reads a drain as the time to empty, in the warning tone", () => {
    expect(
      chargeTrendBadges({
        direction: "draining",
        ...none,
        secondsToEmpty: 450,
        atLimit: false,
      }),
    ).toMatchObject([
      { label: expect.stringMatching(/^Empty in 7/), tone: "warn" },
    ]);
  });

  it("reads a measured zero as empty, in the red tone", () => {
    expect(
      chargeTrendBadges({ direction: "draining", ...none, atLimit: true }),
    ).toMatchObject([{ label: "Empty", tone: "nogo" }]);
  });

  it("marks a carried-forward time as approximate and blue, and a crossed zero as likely empty", () => {
    expect(
      chargeTrendBadges({
        direction: "draining",
        ...none,
        secondsToEmpty: 790,
        atLimit: false,
        modelled: true,
      }),
    ).toMatchObject([
      { label: expect.stringMatching(/^Empty in ~13/), tone: "info" },
    ]);
    expect(
      chargeTrendBadges({
        direction: "draining",
        ...none,
        atLimit: true,
        modelled: true,
        emptySinceUt: value("ut", 5),
      }),
    ).toMatchObject([{ label: "Likely empty", tone: "nogo" }]);
  });

  it("names a charge and a level store by their direction", () => {
    expect(
      chargeTrendBadges({ direction: "charging", ...none, atLimit: false }),
    ).toMatchObject([{ label: "Charging", tone: "go" }]);
  });
});
