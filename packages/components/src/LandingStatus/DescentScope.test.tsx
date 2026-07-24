import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { DescentScope } from "./DescentScope";

describe("DescentScope", () => {
  const solved = {
    verticalSpeed: 40,
    horizontalSpeed: 15,
    twr: 2.4,
    usingComDatum: false,
  };

  it("renders a TWR gauge and a velocity vector with a text equivalent", () => {
    render(<DescentScope {...solved} />);
    expect(screen.getByRole("img", { name: /TWR/i })).toBeInTheDocument();
    // The velocity vector carries its numbers in the accessible name.
    expect(
      screen.getByRole("img", { name: /descent .*ground speed/i }),
    ).toBeInTheDocument();
  });

  it("notes the centre-of-mass datum fallback when the lowest-point datum is absent", () => {
    render(<DescentScope {...solved} usingComDatum />);
    expect(screen.getByText(/centre-of-mass/i)).toBeInTheDocument();
  });

  it("survives a fully-null (pre-data) state without throwing", () => {
    render(
      <DescentScope
        verticalSpeed={null}
        horizontalSpeed={null}
        twr={null}
        usingComDatum={false}
      />,
    );
    // The velocity vector still renders its (empty) text equivalent.
    expect(
      screen.getByRole("img", { name: /descent .*ground speed/i }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<DescentScope {...solved} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
