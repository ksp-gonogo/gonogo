import { act, harnessTheme, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsConsentModal } from "../analytics/AnalyticsConsentModal";
import { AnalyticsConsentService } from "../analytics/AnalyticsConsentService";
import type { ConsentInfo } from "./consent";
import { type FirstLoadPromptOptions, promptForConsents } from "./consentModal";
import { resolveUplinkIdentity } from "./identity";

/**
 * The first-load page, which mounts its own root outside React's tree. It asks
 * every Uplink's question and the logs question on one page, and resolves only
 * once each has an answer.
 */

const PLOTTER: ConsentInfo = {
  id: "plotter",
  name: "Plotter",
  version: "0.0.1",
  author: "jpeps",
  identity: resolveUplinkIdentity(
    "plotter",
    { name: "Plotter", author: "jpeps" },
    {},
  ),
  mod: { name: "Plotter", builtAgainst: "1.6.0.1" },
};

const SURVEY: ConsentInfo = {
  id: "survey",
  name: "Survey",
  version: "0.0.1",
  mod: { name: "Survey", builtAgainst: "20.4" },
};

const DECLARED = {
  name: "Example",
  author: "Somebody",
  repo: "https://example.invalid/somebody/example",
};

afterEach(() => {
  // A page left standing would keep its isolation applied to the next test.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  localStorage.clear();
});

/**
 * The answers are handed back boxed. An `async` function that returns a promise
 * flattens it, which here would mean awaiting the operator's clicks before the
 * test body ever ran.
 */
async function openPage(
  uplinks: readonly ConsentInfo[],
  options: FirstLoadPromptOptions = {},
): Promise<{ answers: Promise<boolean[]> }> {
  let answers!: Promise<boolean[]>;
  await act(async () => {
    answers = promptForConsents(uplinks, harnessTheme, options);
  });
  await screen.findByRole("dialog", { name: "Before you start" });
  return { answers };
}

function rowButton(
  group: string,
  name: "Skip" | "Load" | "Decline" | "Enable",
) {
  const row = screen.getByRole("group", { name: group });
  const button = [...row.querySelectorAll("button")].find(
    (b) => b.textContent === name,
  );
  if (!button) throw new Error(`no ${name} in ${group}`);
  return button;
}

async function press(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

describe("the first-load page", () => {
  it("asks every Uplink on one page and answers each in the order given", async () => {
    const { answers } = await openPage([PLOTTER, SURVEY]);
    const proceed = screen.getByRole("button", { name: "Continue" });
    expect(proceed).toBeDisabled();
    expect(screen.getByText("2 still to answer")).toBeInTheDocument();

    await press(rowButton("Load Plotter Uplink?", "Load"));
    await press(rowButton("Load Survey Uplink?", "Skip"));
    expect(proceed).toBeEnabled();
    await press(proceed);

    await expect(answers).resolves.toEqual([true, false]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("titles each row as the Uplink, with the mod version it was built for", async () => {
    const { answers } = await openPage([
      PLOTTER,
      { ...SURVEY, name: "Survey Uplink" },
    ]);
    expect(screen.getByText("Plotter Uplink")).toBeInTheDocument();
    expect(screen.getByText("Built for Plotter 1.6.0.1")).toBeInTheDocument();
    // A name that already says Uplink is not said twice.
    expect(screen.getByText("Survey Uplink")).toBeInTheDocument();
    expect(screen.queryByText(/Uplink Uplink/)).not.toBeInTheDocument();
    await expectNoA11yViolations(document.body);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await answers;
  });

  it("says nothing about a mod the manifest does not name", async () => {
    const { answers } = await openPage([{ ...SURVEY, mod: undefined }]);
    expect(screen.queryByText(/Built for/)).not.toBeInTheDocument();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await answers;
  });

  it("keeps Tab inside the page", async () => {
    const { answers } = await openPage([PLOTTER, SURVEY]);
    const dialog = screen.getByRole("dialog", { name: "Before you start" });
    const user = userEvent.setup();
    for (let i = 0; i < 10; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await answers;
  });

  it("answers what is still open with Skip on Escape, and keeps what was chosen", async () => {
    const { answers } = await openPage([PLOTTER, SURVEY]);
    await press(rowButton("Load Plotter Uplink?", "Load"));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await expect(answers).resolves.toEqual([true, false]);
  });
});

describe("the anonymous-logs question", () => {
  it("is asked beside the Uplinks and its answer is written to the service", async () => {
    const service = new AnalyticsConsentService();
    const { answers } = await openPage([PLOTTER], { logs: service });
    expect(screen.getByText("2 still to answer")).toBeInTheDocument();
    expect(
      screen.getByText("Send anonymous errors and logs to the developer."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mission data/)).not.toBeInTheDocument();

    await press(rowButton("Load Plotter Uplink?", "Skip"));
    await press(rowButton("Send anonymous logs?", "Enable"));
    await press(screen.getByRole("button", { name: "Continue" }));

    await expect(answers).resolves.toEqual([false]);
    expect(service.isEnabled()).toBe(true);
  });

  it("is declined by Escape like every other open question", async () => {
    const service = new AnalyticsConsentService();
    const { answers } = await openPage([PLOTTER], { logs: service });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await answers;
    expect(service.hasAnswered()).toBe(true);
    expect(service.isEnabled()).toBe(false);
  });

  it("is not asked when the caller does not pass it, as on a station", async () => {
    const { answers } = await openPage([{ ...PLOTTER, onStation: true }]);
    expect(screen.queryByText(/anonymous/i)).not.toBeInTheDocument();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await answers;
  });
});

/*
 * The consent moment is where the difference between a vouched identity and a
 * self-declared one has to be legible, because it is the only moment an
 * operator gets to weigh it.
 */
describe("identity provenance on the first-load page", () => {
  it("shows a mod-vouched author and repo, and names the mod as the voucher", async () => {
    const { answers } = await openPage([
      {
        ...SURVEY,
        id: "example",
        name: "Example",
        identity: resolveUplinkIdentity("example", DECLARED, {}),
      },
    ]);
    expect(screen.getByText("Example Uplink")).toBeInTheDocument();
    expect(screen.getByText("by Somebody")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.invalid/somebody/example"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vouched by the installed mod"),
    ).toBeInTheDocument();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await answers;
  });

  it("puts the bundle's competing claims in front of the operator deciding", async () => {
    const { answers } = await openPage([
      {
        ...SURVEY,
        id: "example",
        name: "Example",
        identity: resolveUplinkIdentity("example", DECLARED, {
          name: "Impostor",
          author: "Impostor",
        }),
      },
    ]);
    expect(screen.getByText("Example Uplink")).toBeInTheDocument();
    expect(
      screen.getByText("Bundle's own name: “Impostor”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bundle's own author: “Impostor”"),
    ).toBeInTheDocument();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await answers;
  });

  /*
   * A bundle must not get to write the title of the row deciding whether to
   * run it: a self-declared name is shown as one the bundle calls itself,
   * while the title falls back to the id the mod reported.
   */
  it("titles the row with the mod-reported id, not the name a bundle claims for itself", async () => {
    const { answers } = await openPage([
      {
        ...SURVEY,
        id: "gonogo-example",
        name: "Example",
        identity: resolveUplinkIdentity("gonogo-example", {}, DECLARED),
      },
    ]);
    expect(screen.getByText("gonogo-example Uplink")).toBeInTheDocument();
    expect(screen.getByText("Calls itself “Example”")).toBeInTheDocument();
    expect(
      screen.getByText("Self-declared by the bundle, unverified"),
    ).toBeInTheDocument();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await answers;
  });
});

describe("the first-load page's nested-modal guard", () => {
  it("isolates what is behind it and restores on close", async () => {
    const behind = document.createElement("div");
    document.body.append(behind);

    const { answers } = await openPage([PLOTTER]);
    expect(behind).toHaveAttribute("inert");
    expect(behind).toHaveAttribute("aria-hidden", "true");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await answers;

    expect(behind).not.toHaveAttribute("inert");
    expect(behind).not.toHaveAttribute("aria-hidden");
    behind.remove();
  });

  it("leaves the outer gate's isolation in place when it closes on top of it", async () => {
    const behind = document.createElement("div");
    document.body.append(behind);

    const consentService = new AnalyticsConsentService();
    const outer = document.createElement("div");
    document.body.append(outer);
    const { createRoot } = await import("react-dom/client");
    const outerRoot = createRoot(outer);
    await act(async () => {
      outerRoot.render(<AnalyticsConsentModal service={consentService} />);
    });
    await waitFor(() => expect(behind).toHaveAttribute("inert"));

    const { answers } = await openPage([PLOTTER]);
    await press(rowButton("Load Plotter Uplink?", "Skip"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await answers;

    // The outer gate is still open, so the page must still be isolated.
    expect(behind).toHaveAttribute("inert");
    expect(behind).toHaveAttribute("aria-hidden", "true");

    await act(async () => {
      outerRoot.unmount();
    });
    expect(behind).not.toHaveAttribute("inert");

    outer.remove();
    behind.remove();
  });
});
