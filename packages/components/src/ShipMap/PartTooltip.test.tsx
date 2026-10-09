import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { PartTooltip } from "./PartTooltip";
import type { ShipMapPart } from "./shipTopology";

const PART: ShipMapPart = {
  flightId: 1,
  parentFlightId: null,
  name: "probeCore",
  title: "Probe Core",
  type: "capsule",
  lat: 0,
  axial: 0,
  depth: 0,
  rotationRad: 0,
  size: { x: 1, y: 1, z: 1 },
  latHalfExtent: 0.5,
  axialHalfExtent: 0.5,
  dryMass: 0.1,
  stage: 0,
  maxTemp: 1200,
};

/** The text of every figure carrying the held mark: a `Unit` stamps `data-held`, a text figure carries the mark inside it. */
function heldRows(): string[] {
  return [
    ...Array.from(document.querySelectorAll("[data-held]")),
    ...Array.from(document.querySelectorAll("[data-held-mark]")).map(
      (mark) => mark.parentElement,
    ),
  ].map((el) => el?.textContent ?? "");
}

describe("PartTooltip: contributed status rows", () => {
  it("marks a text row held while the reading it came from is held, and leaves a current one plain", () => {
    render(
      <PartTooltip
        hovered={PART}
        meters={[]}
        meta={[
          {
            partId: "1",
            label: "Recycler",
            kind: "text",
            text: "running",
            held: "disconnected",
          },
          { partId: "1", label: "Scrubber", kind: "text", text: "idle" },
        ]}
        pointer={{ x: 0, y: 0 }}
        showActionCount={false}
      />,
    );
    expect(screen.getByText("running")).toBeTruthy();
    expect(heldRows().some((text) => text.includes("running"))).toBe(true);
    expect(heldRows().some((text) => text.includes("idle"))).toBe(false);
  });

  it("marks a ratio row's meter held while the reading it came from is held", () => {
    render(
      <PartTooltip
        hovered={PART}
        meters={[]}
        meta={[
          {
            partId: "1",
            label: "Efficiency",
            kind: "ratio",
            tone: "info",
            value: 0.5,
            held: "disconnected",
          },
        ]}
        pointer={{ x: 0, y: 0 }}
        showActionCount={false}
      />,
    );
    expect(heldRows()).not.toHaveLength(0);
  });
});
