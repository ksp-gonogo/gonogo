import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { BodyMark } from "./BodyMark";
import type { PlacedBody } from "./diagramGeometry";
import type { CelestialBody } from "./useCelestialBodies";

const MUN = {
  index: 2,
  name: "Mun",
  referenceBody: "Kerbin",
  semiMajorAxis: 12_000_000,
} as CelestialBody;

function mark(held: boolean) {
  const placed = {
    body: MUN,
    held,
    x: 40,
    y: 0,
    depthUnits: 0,
  } as unknown as PlacedBody;
  return render(
    <svg>
      <title>diagram</title>
      <BodyMark
        placed={placed}
        parentAt={{ x: 0, y: 0, depthUnits: 0 }}
        zoom={1}
        tone="plain"
        phaseAngle={undefined}
        transferStatus={undefined}
        onHoverStart={() => {}}
        onHoverEnd={() => {}}
        pinned={false}
        onActivate={() => {}}
      />
    </svg>,
  );
}

/** A body placed from a held pose says so, by its mark and by its name, as a held craft does. */
describe("BodyMark", () => {
  it("draws a body placed from a held pose dimmed and dashed, and names it held", () => {
    const { container } = mark(true);

    const dot = container.querySelector('[data-body="Mun"]');
    expect(dot).toHaveAttribute("data-body-held");
    expect(dot).toHaveAttribute("stroke-dasharray");
    expect(dot).toHaveAttribute("fill-opacity", "0.5");
    expect(
      screen.getByRole("button", { name: "Mun, held" }),
    ).toBeInTheDocument();
  });

  it("draws a body placed from a current pose at full strength", () => {
    const { container } = mark(false);

    const dot = container.querySelector('[data-body="Mun"]');
    expect(dot).not.toHaveAttribute("data-body-held");
    expect(dot).not.toHaveAttribute("stroke-dasharray");
    expect(screen.getByRole("button", { name: "Mun" })).toBeInTheDocument();
  });
});
