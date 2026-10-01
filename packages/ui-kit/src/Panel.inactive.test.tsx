import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Panel } from "./Panel";
import { Section } from "./Section";
import { expectNoA11yViolations } from "./testing";

describe("Panel inactive", () => {
  it("keeps the title and says the reason in place of the body", () => {
    render(
      <Panel
        panelTitle="CONTRACTS"
        inactive="Vessel in flight required"
        sections={<Section>live figures</Section>}
        panelFooter="footer"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "CONTRACTS" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vessel in flight required",
    );
    expect(screen.queryByText("live figures")).toBeNull();
    expect(screen.queryByText("footer")).toBeNull();
  });

  it("draws the hint under the reason", () => {
    render(
      <Panel
        panelTitle="CONTRACTS"
        inactive={{ reason: "No flight", hint: "Launch a vessel" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No flightLaunch a vessel",
    );
  });

  it("renders the sections as normal when not inactive", () => {
    render(
      <Panel
        panelTitle="CONTRACTS"
        sections={<Section>live figures</Section>}
      />,
    );
    expect(screen.getByText("live figures")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Panel panelTitle="CONTRACTS" inactive="Vessel in flight required" />,
    );
    await expectNoA11yViolations(container);
  });
});
