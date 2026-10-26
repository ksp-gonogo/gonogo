import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("points physical controls at Settings, Devices and gives the Chrome page for USB serial on http", async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpSettings />);
    await user.click(screen.getByRole("button", { name: "Physical controls" }));
    expect(screen.getByText(/in Settings, Devices/)).toBeInTheDocument();
    expect(
      screen.getByText(/unsafely-treat-insecure-origin-as-secure/),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("points signal delay at the game's Difficulty settings and says what CommNet off does", async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpSettings />);
    await user.click(screen.getByRole("button", { name: "Signal delay" }));
    expect(screen.getByText(/Difficulty settings/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /CommNet option disabled, every craft counts as connected/,
      ),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("draws each shortcut as keycaps beside what it does", async () => {
    const user = userEvent.setup();
    const { container } = render(<HelpSettings />);
    await user.click(
      screen.getByRole("button", { name: "Keyboard shortcuts" }),
    );
    const undo = screen.getByText("Undo a layout change or switch");
    const keys = undo.closest("dd")?.previousElementSibling;
    expect(
      Array.from(keys?.querySelectorAll("kbd") ?? [], (k) => k.textContent),
    ).toEqual(["Ctrl", "Z"]);
    expect(keys?.textContent).toBe("Ctrl+Z");
    await expectNoA11yViolations(container);
  });

  function keysOf(action: string) {
    const keys = screen.getByText(action).closest("dd")?.previousElementSibling;
    return Array.from(
      keys?.querySelectorAll("kbd") ?? [],
      (k) => k.textContent,
    );
  }

  describe("keyboard shortcut tabs", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("opens on Windows and Linux off a Mac, with Ctrl Y as a second way to redo", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
      const user = userEvent.setup();
      const { container } = render(<HelpSettings />);
      await user.click(
        screen.getByRole("button", { name: "Keyboard shortcuts" }),
      );
      expect(
        screen.getByRole("tab", { name: "Windows and Linux" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(keysOf("Redo")).toEqual(["Ctrl", "Shift", "Z", "Ctrl", "Y"]);
      await expectNoA11yViolations(container);
    });

    it("opens on macOS on a Mac, with Cmd and only the redo that works there", async () => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      const user = userEvent.setup();
      render(<HelpSettings />);
      await user.click(
        screen.getByRole("button", { name: "Keyboard shortcuts" }),
      );
      expect(screen.getByRole("tab", { name: "macOS" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(keysOf("Undo a layout change or switch")).toEqual(["Cmd", "Z"]);
      expect(keysOf("Redo")).toEqual(["Cmd", "Shift", "Z"]);
    });
  });

  it("never prints the engineering codename or an em-dash", () => {
    const all = JSON.stringify(HELP_TOPICS);
    expect(all).not.toMatch(/sitrep/i);
    expect(all).not.toContain(String.fromCodePoint(0x2014));
  });
});
