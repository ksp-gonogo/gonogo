import type { VesselTopology } from "@ksp-gonogo/core";
import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import lfv2WaveProbe from "./__fixtures__/lfv2-wave-probe-14parts.json";
import { ShipDiagram } from "./ShipDiagram";
import { buildShipMapPart, pickLateralAxis } from "./shipTopology";

/** A captured topology fixture; its free-text note is declared because an undeclared key fails the cast. */
interface Fixture {
  "v.topology": VesselTopology;
  _comment?: string;
}

function partsOf(fixture: Fixture) {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  return topo.parts.map((p) => buildShipMapPart(p, undefined, undefined, useX));
}

describe("the expand icon on a dense cluster", () => {
  it("appears beside the probe's ring of nine, closed", () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", {
      name: "Expand the 9 parts clustered here",
    });
    expect(icon.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-role="cluster-box"]')).toBeNull();
  });

  it("is absent on a craft with no cluster", () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(fuellinePostStage2 as Fixture)}
        width={600}
        height={700}
      />,
    );
    expect(container.querySelector('[data-role="cluster-expand"]')).toBeNull();
  });

  it("opens a box with each part and a leader line to it when pressed", () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand the 9 parts/ }));
    const box = container.querySelector('[data-role="cluster-box"]');
    expect(box).not.toBeNull();
    const members = container.querySelectorAll('[data-role="cluster-member"]');
    expect(members).toHaveLength(9);
    for (const m of members) expect(m.querySelector("line")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /Close the 9 parts/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("opens from the keyboard and closes on Escape with focus back on the icon", () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    const icon = screen.getByRole("button", { name: /Expand the 9 parts/ });
    fireEvent.keyDown(icon, { key: "Enter" });
    const close = screen.getByRole("button", {
      name: "Close the expanded parts",
    });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Escape" });
    expect(container.querySelector('[data-role="cluster-box"]')).toBeNull();
    expect(document.activeElement?.getAttribute("data-role")).toBe(
      "cluster-expand",
    );
  });

  it("has no accessibility violations with the box open", async () => {
    const { container } = render(
      <ShipDiagram
        parts={partsOf(lfv2WaveProbe as Fixture)}
        width={600}
        height={700}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand the 9 parts/ }));
    await expectNoA11yViolations(container);
  });
});
