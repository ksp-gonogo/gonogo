import { act, fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fab } from "./Fab";
import { FabClusterProvider } from "./FabCluster";
import { FabClusterToggle } from "./FabClusterToggle";

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (
      query: string,
    ): Pick<
      MediaQueryList,
      "matches" | "media" | "addEventListener" | "removeEventListener"
    > => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

function renderCluster() {
  render(
    <FabClusterProvider>
      <Fab bottom={84} aria-label="Settings">
        s
      </Fab>
    </FabClusterProvider>,
  );
  return screen.getByRole("button", { name: "Settings" });
}

describe("FabCluster", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps secondaries hidden until hover on a fine pointer", () => {
    stubPointer(false);
    const button = renderCluster();
    expect(button).toHaveAttribute("tabindex", "-1");
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(button).toHaveAttribute("tabindex", "0");
  });

  describe("on a coarse pointer", () => {
    function renderTouch() {
      stubPointer(true);
      render(
        <FabClusterProvider>
          <FabClusterToggle />
          <Fab bottom={84} aria-label="Settings">
            s
          </Fab>
        </FabClusterProvider>,
      );
      return {
        toggle: screen.getByRole("button", { name: "Dashboard controls" }),
        settings: screen.getByRole("button", { name: "Settings" }),
      };
    }

    it("keeps secondaries hidden until the toggle is tapped, whatever hover or focus a touch synthesises", async () => {
      const { toggle, settings } = renderTouch();
      expect(settings).toHaveAttribute("tabindex", "-1");
      fireEvent.mouseEnter(toggle);
      act(() => toggle.focus());
      expect(settings).toHaveAttribute("tabindex", "-1");

      await userEvent.setup().click(toggle);

      expect(settings).toHaveAttribute("tabindex", "0");
      expect(screen.getByText("Settings", { selector: "span" })).toBeVisible();
    });

    it("closes when the toggle is tapped again", async () => {
      const user = userEvent.setup();
      const { toggle, settings } = renderTouch();
      await user.click(toggle);
      await user.click(toggle);
      expect(settings).toHaveAttribute("tabindex", "-1");
    });

    it("closes after a button in the cluster is chosen", async () => {
      const user = userEvent.setup();
      const { toggle, settings } = renderTouch();
      await user.click(toggle);
      await user.click(settings);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(settings).toHaveAttribute("tabindex", "-1");
    });
  });

  describe("toggle", () => {
    function renderWithToggle() {
      stubPointer(false);
      render(
        <FabClusterProvider>
          <FabClusterToggle />
          <Fab bottom={84} aria-label="Settings">
            s
          </Fab>
        </FabClusterProvider>,
      );
      return {
        toggle: screen.getByRole("button", { name: "Dashboard controls" }),
        settings: screen.getByRole("button", { name: "Settings" }),
      };
    }

    it("opens and closes the cluster by click, with no hover involved", async () => {
      const user = userEvent.setup();
      const { toggle, settings } = renderWithToggle();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(settings).toHaveAttribute("tabindex", "-1");

      await user.click(toggle);
      await user.unhover(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(settings).toHaveAttribute("tabindex", "0");

      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("opens on Enter and Space and points aria-controls at the cluster", async () => {
      const user = userEvent.setup();
      const { toggle } = renderWithToggle();
      expect(
        document.getElementById(toggle.getAttribute("aria-controls") ?? ""),
      ).not.toBeNull();

      act(() => toggle.focus());
      await user.keyboard("{Enter}");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      await user.keyboard(" ");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("closes on Escape and returns focus to the toggle", async () => {
      const user = userEvent.setup();
      const { toggle, settings } = renderWithToggle();
      await user.click(toggle);
      act(() => settings.focus());

      await user.keyboard("{Escape}");

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveFocus();
    });

    it("closes when a pointer lands outside the cluster", async () => {
      const user = userEvent.setup();
      const { toggle } = renderWithToggle();
      await user.click(toggle);

      await user.click(document.body);

      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });
  });
});
