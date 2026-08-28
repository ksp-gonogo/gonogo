import { act, harnessTheme, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsConsentModal } from "../analytics/AnalyticsConsentModal";
import { AnalyticsConsentService } from "../analytics/AnalyticsConsentService";
import { promptForConsent } from "./consentModal";

/**
 * The Uplink consent prompt, which mounts its own root outside React's tree.
 * Two things under test: that a keyboard operator can answer it, and that the
 * nested-modal guard still holds now that both consent gates share one
 * refcounted implementation, this prompt is the one that opens OVER something
 * else (the Settings > Uplink Hub wizard's Load button) rather than at boot.
 */

const info = {
  id: "gonogo-example-uplink",
  name: "Example",
  version: "1.2.3",
  author: "Somebody",
};

afterEach(() => {
  // Any prompt left standing would keep its isolation applied to the next test.
  for (const button of screen.queryAllByRole("button", {
    name: "Don’t load",
  })) {
    button.click();
  }
});

/**
 * The decision is handed back boxed. An `async` function that returns a promise
 * flattens it, which here would mean awaiting the operator's click before the
 * test body ever ran.
 */
async function openPrompt(): Promise<{ decision: Promise<boolean> }> {
  let decision!: Promise<boolean>;
  await act(async () => {
    decision = promptForConsent(info, harnessTheme);
  });
  await screen.findByRole("dialog", { name: /Load Uplink/ });
  return { decision };
}

describe("promptForConsent keyboard access", () => {
  it("puts focus on Load and keeps Tab inside the dialog", async () => {
    const { decision } = await openPrompt();
    const dialog = screen.getByRole("dialog", { name: /Load Uplink/ });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Load" }),
    );

    const user = userEvent.setup();
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await act(async () => {
      screen.getByRole("button", { name: "Don’t load" }).click();
    });
    await expect(decision).resolves.toBe(false);
  });

  it("declines on Escape", async () => {
    const { decision } = await openPrompt();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await expect(decision).resolves.toBe(false);
  });
});

describe("promptForConsent nested-modal guard", () => {
  it("isolates what is behind it and restores on close", async () => {
    const behind = document.createElement("div");
    document.body.append(behind);

    const { decision } = await openPrompt();
    expect(behind).toHaveAttribute("inert");
    expect(behind).toHaveAttribute("aria-hidden", "true");

    await act(async () => {
      screen.getByRole("button", { name: "Don’t load" }).click();
    });
    await decision;

    expect(behind).not.toHaveAttribute("inert");
    expect(behind).not.toHaveAttribute("aria-hidden");
    behind.remove();
  });

  it("leaves the outer gate's isolation in place when it closes on top of it", async () => {
    // The page behind both gates.
    const behind = document.createElement("div");
    document.body.append(behind);

    // The analytics gate opens first and isolates the page.
    const consentService = new AnalyticsConsentService();
    const outer = document.createElement("div");
    document.body.append(outer);
    const { createRoot } = await import("react-dom/client");
    const outerRoot = createRoot(outer);
    await act(async () => {
      outerRoot.render(<AnalyticsConsentModal service={consentService} />);
    });
    await waitFor(() => expect(behind).toHaveAttribute("inert"));

    // The Uplink prompt opens over it, then closes.
    const { decision } = await openPrompt();
    await act(async () => {
      screen.getByRole("button", { name: "Don’t load" }).click();
    });
    await decision;

    // The outer gate is still open, so the page must still be isolated. A
    // set/remove guard without refcounting hands the page back here.
    expect(behind).toHaveAttribute("inert");
    expect(behind).toHaveAttribute("aria-hidden", "true");

    await act(async () => {
      outerRoot.unmount();
    });
    expect(behind).not.toHaveAttribute("inert");

    outer.remove();
    behind.remove();
    localStorage.clear();
  });
});
