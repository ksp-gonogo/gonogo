import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { VesselInfoPanel } from "./VesselInfoPanel";

describe("VesselInfoPanel for a craft on the ground", () => {
  it("shows the site and the position beside the body", () => {
    render(
      <VesselInfoPanel
        meta={{
          name: "Sally-Hut 1 · Runway",
          type: "Base",
          situation: "Landed",
          body: "Kerbin",
          site: "Runway",
          position: "0.05°S 74.72°W",
        }}
      />,
    );
    expect(screen.getByText("Site").nextSibling).toHaveTextContent("Runway");
    expect(screen.getByText("Position").nextSibling).toHaveTextContent(
      "0.05°S 74.72°W",
    );
  });

  it("shows neither row for a craft with no place on the ground", () => {
    render(
      <VesselInfoPanel
        meta={{
          name: "Tester",
          type: "Ship",
          situation: "Orbiting",
          body: "Kerbin",
        }}
      />,
    );
    expect(screen.queryByText("Site")).toBeNull();
    expect(screen.queryByText("Position")).toBeNull();
  });
});
