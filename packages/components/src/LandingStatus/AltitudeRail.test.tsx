import { render, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { AltitudeRail } from "./AltitudeRail";

describe("AltitudeRail", () => {
  const descending = {
    aglMeters: 1200,
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

  it("survives a fully-null (pre-data) state without throwing", () => {
    render(
      <AltitudeRail
        aglMeters={null}
        ignitionAltitude={null}
        suicideBurnCountdown={null}
      />,
    );
    // The ladder still renders, reporting 0 with no data.
    expect(
      screen.getByRole("meter", { name: /altitude above terrain/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no burn/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<AltitudeRail {...descending} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
