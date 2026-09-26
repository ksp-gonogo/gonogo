import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { AltitudeRail } from "./AltitudeRail";

const AT = value("ut", 12_000);

function observed(m: number): Reading<Value<"m">> {
  return {
    state: "observed",
    value: value("m", m),
    atUt: AT,
    reckoning: { status: "none" },
  };
}

describe("AltitudeRail", () => {
  const descending = {
    agl: observed(1200),
    ignitionAltitude: 300,
    suicideBurnCountdown: 8,
  };

  it("renders the altitude ladder as a meter reporting AGL", () => {
    render(<AltitudeRail {...descending} />);
    const ladder = screen.getByRole("meter", {
      name: /altitude above terrain/i,
    });
    expect(ladder).toHaveAttribute("aria-valuenow", "1200");
  });

  it("shows the ignition cue when a burn is pending", () => {
    render(<AltitudeRail {...descending} />);
    expect(visibleText()).toMatch(/ignite in 8s/i);
  });

  it("reads 'past ignition' once the burn window has opened", () => {
    render(<AltitudeRail {...descending} suicideBurnCountdown={-1} />);
    expect(screen.getByText(/past ignition/i)).toBeInTheDocument();
  });

  it("draws the null token rather than a height of zero before data arrives", () => {
    render(
      <AltitudeRail
        agl={{ state: "pending", reckoning: { status: "none" } }}
        ignitionAltitude={null}
        suicideBurnCountdown={null}
      />,
    );
    expect(screen.queryByRole("meter")).toBeNull();
    expect(
      screen.getByRole("img", {
        name: `Altitude above terrain: ${NULL_DISPLAY}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no burn/i)).toBeInTheDocument();
  });

  it("holds a height that has stopped arriving and says so on the rail", () => {
    render(
      <AltitudeRail
        {...descending}
        agl={{
          state: "stale",
          value: value("m", 1200),
          asOfUt: AT,
          grade: "held-stale",
          reckoning: { status: "none" },
        }}
      />,
    );
    const ladder = screen.getByRole("meter", {
      name: /altitude above terrain.*stale/i,
    });
    expect(ladder).toHaveAttribute("aria-valuenow", "1200");
  });

  it("has no axe violations", async () => {
    const { container } = render(<AltitudeRail {...descending} />);
    await expectNoA11yViolations(container);
  });
});
