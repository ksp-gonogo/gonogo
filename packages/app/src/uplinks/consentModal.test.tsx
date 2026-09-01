import { act, harnessTheme, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsConsentModal } from "../analytics/AnalyticsConsentModal";
import { AnalyticsConsentService } from "../analytics/AnalyticsConsentService";
import type { ConsentInfo } from "./consent";
import { promptForConsent } from "./consentModal";
import { resolveUplinkIdentity } from "./identity";

/**
 * The Uplink consent prompt, which mounts its own root outside React's tree.
 * Two things under test: that a keyboard operator can answer it, and that the
 * nested-modal guard still holds now that both consent gates share one
 * refcounted implementation, this prompt is the one that opens OVER something
 * else (the Settings > Uplink Hub wizard's Load button) rather than at boot.
 */

const info: ConsentInfo = {
  id: "gonogo-example-uplink",
  name: "Example",
  version: "1.2.3",
  author: "Somebody",
};

const DECLARED = {
  name: "Example",
  author: "Somebody",
  repo: "https://example.invalid/somebody/example",
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
async function openPrompt(
  which: ConsentInfo = info,
): Promise<{ decision: Promise<boolean> }> {
  let decision!: Promise<boolean>;
  await act(async () => {
    decision = promptForConsent(which, harnessTheme);
  });
  await screen.findByRole("dialog", { name: /Load Uplink/ });
  return { decision };
}

async function closePrompt(decision: Promise<boolean>): Promise<void> {
  await act(async () => {
    screen.getByRole("button", { name: "Don’t load" }).click();
  });
  await decision;
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

/*
 * The consent moment is where the difference between a vouched identity and a
 * self-declared one has to be legible, because it is the only moment an
 * operator gets to weigh it. Both dialogs show the author and the repo; only
 * one of them says the mod vouched for them.
 */
describe("promptForConsent identity provenance", () => {
  it("shows a mod-vouched author and repo, and names the mod as the voucher", async () => {
    const { decision } = await openPrompt({
      ...info,
      identity: resolveUplinkIdentity(info.id, DECLARED, {}),
    });

    expect(
      screen.getByRole("heading", { name: "Load Uplink “Example”?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("by Somebody")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.invalid/somebody/example"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vouched by the installed mod"),
    ).toBeInTheDocument();

    await closePrompt(decision);
  });

  /*
   * The whole point of surfacing a disagreement before the pull: this dialog is
   * where the operator answers, and the mod and the bundle naming the same
   * Uplink differently is a fact they need in front of them while answering.
   * It informs, it does not decide: the mod's values still headline.
   */
  it("puts the bundle's competing claims in front of the operator deciding", async () => {
    const { decision } = await openPrompt({
      ...info,
      identity: resolveUplinkIdentity(info.id, DECLARED, {
        name: "Impostor",
        author: "Impostor",
        repo: "https://example.invalid/impostor/example",
      }),
    });

    expect(
      screen.getByRole("heading", { name: "Load Uplink “Example”?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("by Somebody")).toBeInTheDocument();
    expect(
      screen.getByText("Bundle's own name: “Impostor”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bundle's own author: “Impostor”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bundle's own repo: “https://example.invalid/impostor/example”",
      ),
    ).toBeInTheDocument();

    await closePrompt(decision);
  });

  it("shows a self-declared author and repo as the bundle's own claim", async () => {
    const { decision } = await openPrompt({
      ...info,
      identity: resolveUplinkIdentity(info.id, {}, DECLARED),
    });

    expect(screen.getByText("by Somebody")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.invalid/somebody/example"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Self-declared by the bundle, unverified"),
    ).toBeInTheDocument();

    await closePrompt(decision);
  });

  /*
   * A bundle must not get to write the heading of the dialog deciding whether
   * to run it: a self-declared name is shown as one the bundle calls itself,
   * while the heading falls back to the id the mod reported.
   */
  it("headlines the mod-reported id, not the name a bundle claims for itself", async () => {
    const { decision } = await openPrompt({
      ...info,
      name: "Example",
      identity: resolveUplinkIdentity(info.id, {}, DECLARED),
    });

    expect(
      screen.getByRole("heading", {
        name: "Load Uplink “gonogo-example-uplink”?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Calls itself “Example”")).toBeInTheDocument();

    await closePrompt(decision);
  });

  it("says nothing about an identity nothing declared", async () => {
    const { decision } = await openPrompt({
      id: info.id,
      name: info.id,
      version: info.version,
      identity: resolveUplinkIdentity(info.id, {}, {}),
    });

    expect(screen.queryByText(/^by /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vouched by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Self-declared/)).not.toBeInTheDocument();

    await closePrompt(decision);
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
