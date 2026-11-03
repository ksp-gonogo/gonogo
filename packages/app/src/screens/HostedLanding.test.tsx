import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import {
  CKAN_UPLINK_FILTER,
  LOCAL_APP_URL,
  runCommandFor,
  SETUP_LINKS,
} from "../firstRun/setupGuide";
import { HostedLanding } from "./HostedLanding";

describe("HostedLanding", () => {
  it("gives each step as a headline that opens to its detail", () => {
    const { container } = render(<HostedLanding />);

    const summaries = [...container.querySelectorAll("details > summary")].map(
      (s) => s.querySelector("span:nth-child(2)")?.textContent,
    );
    expect(summaries).toEqual([
      "Install the Gonogo mod in KSP",
      "Start Gonogo on your computer",
      "Open the app and follow the setup",
    ]);
    for (const details of container.querySelectorAll("details"))
      expect(details.open).toBe(false);
  });

  it("gives the command that starts the app", () => {
    render(<HostedLanding />);

    expect(screen.getByRole("heading", { name: "gonogo" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "run command" }).textContent).toBe(
      runCommandFor("posix"),
    );
    expect(
      screen.getByRole("button", { name: "Copy run command" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Docker" })).toHaveAttribute(
      "href",
      SETUP_LINKS.dockerSite,
    );
    expect(screen.getByRole("link", { name: "Podman" })).toHaveAttribute(
      "href",
      SETUP_LINKS.podmanSite,
    );
  });

  it("sends the mod install to CKAN's own guide, with the search that lists Uplinks", () => {
    render(<HostedLanding />);

    expect(screen.getByRole("link", { name: "CKAN" })).toHaveAttribute(
      "href",
      SETUP_LINKS.ckanInstall,
    );
    expect(screen.getByText(CKAN_UPLINK_FILTER)).toBeInTheDocument();
    expect(
      screen.getByText(/Optionally, install Uplinks\. Uplinks are mods/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "GitHub Releases page" }),
    ).toHaveAttribute("href", `${SETUP_LINKS.source}/releases`);
    expect(screen.getByRole("link", { name: "setup guide" })).toHaveAttribute(
      "href",
      SETUP_LINKS.kspSetup,
    );
  });

  it("links Gonogo's SpaceDock page only when the build names its mod id", () => {
    const { unmount } = render(<HostedLanding />);
    expect(screen.queryByRole("link", { name: "SpaceDock" })).toBeNull();
    unmount();

    vi.stubEnv("VITE_SPACEDOCK_MOD_ID", "4321");
    try {
      render(<HostedLanding />);
      expect(screen.getByRole("link", { name: "SpaceDock" })).toHaveAttribute(
        "href",
        "https://spacedock.info/mod/4321",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hands over to the local app, and still offers a station screen", () => {
    render(<HostedLanding />);

    expect(screen.getByRole("link", { name: LOCAL_APP_URL })).toHaveAttribute(
      "href",
      LOCAL_APP_URL,
    );
    expect(
      screen.getByRole("link", { name: "Join someone else's game" }),
    ).toHaveAttribute("href", expect.stringContaining("station"));
    expect(screen.getByRole("link", { name: "API docs" })).toHaveAttribute(
      "href",
      SETUP_LINKS.apiDocs,
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(<HostedLanding />);
    await expectNoA11yViolations(container);
  });
});
