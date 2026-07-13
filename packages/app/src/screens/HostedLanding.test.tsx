import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { HostedLanding } from "./HostedLanding";

describe("HostedLanding", () => {
  it("states the intent and links to setup and a station screen", () => {
    render(<HostedLanding />);

    expect(screen.getByRole("heading", { name: "gonogo" })).toBeInTheDocument();
    expect(screen.getByText(/runs on\s+your own machine/i)).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /set up gonogo/i }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/jonpepler/gonogo"),
    );
    expect(
      screen.getByRole("link", { name: /station screen/i }),
    ).toHaveAttribute("href", expect.stringContaining("station"));
  });

  it("has no axe violations", async () => {
    const { container } = render(<HostedLanding />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
