import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  CKAN_UPLINK_FILTER,
  LOCAL_APP_URL,
  RUN_COMMAND,
  SETUP_LINKS,
} from "../firstRun/setupGuide";
import { HostedLanding } from "./HostedLanding";

describe("HostedLanding", () => {
  it("says the app runs locally and gives the command that starts it", () => {
    render(<HostedLanding />);

    expect(screen.getByRole("heading", { name: "gonogo" })).toBeInTheDocument();
    expect(
      screen.getByText(/runs on your own computer, not on this website/i),
    ).toBeInTheDocument();
    expect(screen.getByText(RUN_COMMAND)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy run command" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "install Docker" }),
    ).toHaveAttribute("href", SETUP_LINKS.docker);
  });

  it("sends the mod install to CKAN's own guide, with the search that lists Uplinks", () => {
    render(<HostedLanding />);

    expect(screen.getByRole("link", { name: "install CKAN" })).toHaveAttribute(
      "href",
      SETUP_LINKS.ckanInstall,
    );
    expect(screen.getByText(CKAN_UPLINK_FILTER)).toBeInTheDocument();
    expect(
      screen.getByText(/Uplinks are optional add-ons/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "KSP setup guide" }),
    ).toHaveAttribute("href", SETUP_LINKS.kspSetup);
  });

  it("hands over to the local app, and still offers a station screen", () => {
    render(<HostedLanding />);

    expect(screen.getByRole("link", { name: LOCAL_APP_URL })).toHaveAttribute(
      "href",
      LOCAL_APP_URL,
    );
    expect(
      screen.getByRole("link", { name: /station screen/i }),
    ).toHaveAttribute("href", expect.stringContaining("station"));
  });

  it("has no axe violations", async () => {
    const { container } = render(<HostedLanding />);
    await expectNoA11yViolations(container);
  });
});
