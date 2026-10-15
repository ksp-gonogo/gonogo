import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpSettings } from "./HelpSettings";
import { HELP_TOPICS } from "./helpTopics";

describe("HelpSettings", () => {
  it("offers every topic, closed until opened", async () => {
    const { container } = render(<HelpSettings />);
    for (const topic of HELP_TOPICS) {
      expect(screen.getByRole("button", { name: topic.title })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
    await expectNoA11yViolations(container);
  });

  it("opens the install topic onto CKAN first and the release zip as the fallback", async () => {
    const user = userEvent.setup();
    render(<HelpSettings />);
    await user.click(
      screen.getByRole("button", { name: "Installing the Gonogo mod" }),
    );
    expect(
      screen.getByText(/search it for Gonogo and install it/),
    ).toBeInTheDocument();
    expect(screen.getByText(/If CKAN does not list it/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Gonogo releases page" }),
    ).toHaveAttribute("href", expect.stringContaining("/releases"));
  });

  it("explains physical controls, USB serial behind its switch and the browser's own prompt", async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpSettings />);
    await user.click(screen.getByRole("button", { name: "Physical controls" }));
    expect(
      screen.getByText(/off until you switch USB serial on/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/That prompt is the browser's/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/unsafely-treat-insecure-origin-as-secure/),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("explains signal delay, where to switch it off and what it leaves alone", async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpSettings />);
    await user.click(screen.getByRole("button", { name: "Signal delay" }));
    expect(screen.getByText(/Difficulty settings/)).toBeInTheDocument();
    expect(
      screen.getByText(/a higher value shortens every delay/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not switch off loss of signal/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /CommNet option disabled, every craft counts as connected/,
      ),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("never prints the engineering codename or an em-dash", () => {
    const all = JSON.stringify(HELP_TOPICS);
    expect(all).not.toMatch(/sitrep/i);
    expect(all).not.toContain(String.fromCodePoint(0x2014));
  });
});
