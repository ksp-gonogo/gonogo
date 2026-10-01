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

  it("draws a prediction beside the pointer with no text on the rail, and none without one", () => {
    const { container, rerender } = render(<AltitudeRail {...descending} />);
    expect(container.querySelector('[data-marker="prediction"]')).toBeNull();
    rerender(
      <AltitudeRail {...descending} prediction={{ value: value("m", 900) }} />,
    );
    expect(
      container.querySelector('[data-marker="prediction"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toMatch(/prediction|burn/);
    const ladder = screen.getByRole("meter", {
      name: /altitude above terrain/i,
    });
    expect(ladder).toHaveAttribute("aria-valuenow", "1200");
    expect(ladder).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/prediction 900\.0 metres/),
    );
  });

  it("draws the model's interval with the bounds a Meter draws, and says it", () => {
    const { container } = render(
      <AltitudeRail
        {...descending}
        prediction={{
          value: value("m", 900),
          bounds: { lo: value("m", 880), hi: value("m", 925) },
        }}
      />,
    );
    expect(container.querySelectorAll("[data-bound]")).toHaveLength(2);
    expect(
      screen.getByRole("meter", { name: /altitude above terrain/i }),
    ).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(
        /prediction 900\.0 metres, between 880\.0 metres and 925\.0 metres/,
      ),
    );
  });

  it("runs the scale down to sea level when the ground stands above it", () => {
    render(<AltitudeRail {...descending} seaLevel={value("m", -3000)} />);
    expect(
      screen.getByRole("meter", { name: /altitude above terrain/i }),
    ).toHaveAttribute("aria-valuemin", "-3000");
  });

  it("keeps the ground and sea level on the rail, pinning sea level to the top when the craft is below it", () => {
    const { container } = render(
      <AltitudeRail {...descending} seaLevel={value("m", 5000)} />,
    );
    expect(container.querySelector('[data-level="ground"]')).not.toBeNull();
    const sea = container.querySelector('[data-level="sea"]');
    expect(sea?.querySelector("[data-off-scale]")).not.toBeNull();
    expect(
      container
        .querySelector('[data-level="ground"]')
        ?.querySelector("[data-off-scale]"),
    ).toBeNull();
  });

  it("names the root-part datum when the lowest point is unavailable", () => {
    render(<AltitudeRail {...descending} centreOfMass />);
    expect(
      screen.getByRole("meter", {
        name: "Root-part altitude above terrain",
      }),
    ).toHaveAttribute("aria-valuenow", "1200");
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
          state: "held",
          value: value("m", 1200),
          asOfUt: AT,
          grade: "held",
          reckoning: { status: "none" },
        }}
      />,
    );
    const ladder = screen.getByRole("meter", {
      name: /^Altitude above terrain, HELD/,
    });
    expect(ladder).toHaveAttribute("aria-valuenow", "1200");
  });

  it("has no axe violations", async () => {
    const { container } = render(<AltitudeRail {...descending} />);
    await expectNoA11yViolations(container);
  });
});
