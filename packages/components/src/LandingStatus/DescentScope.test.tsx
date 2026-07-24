import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { DescentScope } from "./DescentScope";

describe("DescentScope", () => {
  const solved = {
    aglMeters: 1200,
    verticalSpeed: 40,
    horizontalSpeed: 15,
    ignitionAltitude: 300,
    suicideBurnCountdown: 8,
    twr: 2.4,
    usingComDatum: false,
  };

  it("renders the altitude ladder as a meter reporting AGL", () => {
    render(<DescentScope {...solved} />);
    const ladder = screen.getByRole("meter", {
      name: /altitude above terrain/i,
    });
    expect(ladder).toHaveAttribute("aria-valuenow", "1200");
  });

  it("renders a TWR gauge and a velocity vector with a text equivalent", () => {
    render(<DescentScope {...solved} />);
    expect(screen.getByRole("img", { name: /TWR/i })).toBeInTheDocument();
    // The velocity vector carries its numbers in the accessible name.
    expect(
      screen.getByRole("img", { name: /descent .*drift/i }),
    ).toBeInTheDocument();
  });

  it("notes the centre-of-mass datum fallback when the lowest-point datum is absent", () => {
    render(<DescentScope {...solved} usingComDatum />);
    expect(screen.getByText(/centre-of-mass/i)).toBeInTheDocument();
  });

  it("survives a fully-null (pre-data) state without throwing", () => {
    render(
      <DescentScope
        aglMeters={null}
        verticalSpeed={null}
        horizontalSpeed={null}
        ignitionAltitude={null}
        suicideBurnCountdown={null}
        twr={null}
        usingComDatum={false}
      />,
    );
    // AGL meter still present, reporting 0 with no data.
    expect(
      screen.getByRole("meter", { name: /altitude above terrain/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<DescentScope {...solved} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
