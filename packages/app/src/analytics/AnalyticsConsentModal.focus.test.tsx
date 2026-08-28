import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnalyticsConsentModal } from "./AnalyticsConsentModal";
import { AnalyticsConsentService } from "./AnalyticsConsentService";

/**
 * The consent ask is a blocking boot gate: the app will not proceed until it
 * is answered. So a keyboard-only operator must be able to answer it. These
 * assert what that operator actually experiences (focus lands inside, Tab
 * stays inside, Escape answers), not that a particular attribute is present.
 */

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function renderGate() {
  const service = new AnalyticsConsentService();
  const utils = render(<AnalyticsConsentModal service={service} />);
  return { service, ...utils };
}

describe("AnalyticsConsentModal keyboard access", () => {
  it("puts focus inside the dialog on open", async () => {
    renderGate();
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
  });

  it("focuses Decline, so a stray Enter never opts the operator in", async () => {
    renderGate();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Decline" }),
      ),
    );
  });

  it("keeps Tab inside the dialog instead of leaking into the dashboard", async () => {
    // A focusable element in the page behind the gate, exactly what the
    // reported trail escaped into.
    const behind = document.createElement("button");
    behind.textContent = "Toggle SAS";
    document.body.append(behind);

    renderGate();
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    const user = userEvent.setup();
    // Comfortably more presses than the dialog has stops.
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    behind.remove();
  });

  it("cycles Shift+Tab inside the dialog too", async () => {
    renderGate();
    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );

    const user = userEvent.setup();
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("answers as a decline on Escape, so the gate never closes into limbo", async () => {
    const { service } = renderGate();
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(service.get()).toBe("disabled"));
  });

  it("hides everything behind it from the accessibility tree while open", async () => {
    const behind = document.createElement("div");
    behind.id = "app-root-stand-in";
    document.body.append(behind);

    const { unmount } = renderGate();
    await waitFor(() => expect(behind).toHaveAttribute("inert"));
    expect(behind).toHaveAttribute("aria-hidden", "true");

    unmount();
    expect(behind).not.toHaveAttribute("inert");
    expect(behind).not.toHaveAttribute("aria-hidden");

    behind.remove();
  });

  it("has no axe violations", async () => {
    renderGate();
    await expectNoA11yViolations(document.body);
  });
});
