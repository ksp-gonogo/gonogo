import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandBlock } from "./CommandBlock";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
}

describe("CommandBlock", () => {
  it("prints the command and copies exactly that text", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    render(<CommandBlock command="docker ps" label="status command" />);

    expect(screen.getByText("docker ps")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Copy status command" }),
    );

    expect(writeText).toHaveBeenCalledWith("docker ps");
    expect(await screen.findByText("Copied status command")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("says so when the browser refuses the clipboard, since the text is still there to select", async () => {
    const user = userEvent.setup();
    stubClipboard(async () => {
      throw new Error("denied");
    });
    render(<CommandBlock command="docker ps" label="status command" />);

    await user.click(
      screen.getByRole("button", { name: "Copy status command" }),
    );

    expect(
      await screen.findByText("Could not copy, select the text instead"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("Copy");
  });

  it("keeps a long command on one line in a scroll region the keyboard can reach", () => {
    const long =
      "docker run --rm -e KSP_HOST=192.168.1.20 -p 3000:3000 ghcr.io/ksp-gonogo/gonogo:latest";
    render(<CommandBlock command={long} label="run command" />);

    const region = screen.getByRole("group", { name: "run command" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveStyle({ overflowX: "auto" });
    expect(screen.getByText(long)).toHaveStyle({ whiteSpace: "pre" });
    // The button is a sibling of the region, so it does not scroll away with the text.
    expect(region).not.toContainElement(
      screen.getByRole("button", { name: "Copy run command" }),
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CommandBlock command="docker ps" label="status command" />,
    );
    await expectNoA11yViolations(container);
  });
});
