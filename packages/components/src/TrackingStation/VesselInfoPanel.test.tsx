import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { VesselInfoPanel } from "./VesselInfoPanel";

describe("VesselInfoPanel", () => {
  it("renders the vessel's name as the title and every other meta field as a labelled row", () => {
    render(
      <VesselInfoPanel
        meta={{
          name: "Comsat Relay-1",
          type: "Relay",
          situation: "Orbiting",
          body: "Kerbin",
          crew: "0/0",
          comms: "connected",
        }}
      />,
    );
    expect(screen.getByText("Comsat Relay-1")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Relay")).toBeInTheDocument();
    expect(screen.getByText("Situation")).toBeInTheDocument();
    expect(screen.getByText("Orbiting")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByText("Kerbin")).toBeInTheDocument();
    expect(screen.getByText("Crew")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.getByText("Comms")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("falls back to '(unnamed)' when meta carries no name", () => {
    render(<VesselInfoPanel meta={{ type: "Debris" }} />);
    expect(screen.getByText("(unnamed)")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <VesselInfoPanel
        meta={{
          name: "Tester",
          type: "Ship",
          situation: "Orbiting",
          body: "Kerbin",
          crew: "1/1",
          comms: "connected",
        }}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
