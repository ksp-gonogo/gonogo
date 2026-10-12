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

  it("opens the install topic onto the manual route and no mod-manager step", async () => {
    const user = userEvent.setup();
    render(<HelpSettings />);
    await user.click(
      screen.getByRole("button", { name: "Installing the Gonogo mod" }),
    );
    expect(screen.getByText(/not in a mod manager yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Gonogo releases page" }),
    ).toHaveAttribute("href", expect.stringContaining("/releases"));
  });

  it("never prints the engineering codename, an em-dash or a CKAN step", () => {
    const all = JSON.stringify(HELP_TOPICS);
    expect(all).not.toMatch(/sitrep/i);
    expect(all).not.toContain(String.fromCodePoint(0x2014));
    expect(all).not.toMatch(/ckan/i);
  });
});
