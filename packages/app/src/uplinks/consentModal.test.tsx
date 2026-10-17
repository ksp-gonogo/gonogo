import { act, harnessTheme, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { isolateModal } from "../a11y/modalIsolation";
import type { ConsentInfo } from "./consent";
import { promptForConsents } from "./consentModal";
import { resolveUplinkIdentity } from "./identity";

/**
 * The first-load page, which mounts its own root outside React's tree. It asks
 * every Uplink's question on one page, and resolves only once each has an
 * answer.
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

afterEach(async () => {
  // A page left standing would keep its isolation applied to the next test.
  await pressEscape();
  localStorage.clear();
});

/** Presses Escape, which closes the page, inside `act` so its unmount lands within the test. */
async function pressEscape(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

/**
 * The answers are handed back boxed. An `async` function that returns a promise
 * flattens it, which here would mean awaiting the operator's clicks before the
 * test body ever ran.
 */
async function openPage(
  uplinks: readonly ConsentInfo[],
): Promise<{ answers: Promise<boolean[]> }> {
  let answers!: Promise<boolean[]>;
  await act(async () => {
    answers = promptForConsents(uplinks, harnessTheme);
  });
  await screen.findByRole("dialog", { name: "Before you start" });
  return { answers };
}

function rowButton(group: string, name: "Skip" | "Load") {
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
    await pressEscape();
    await answers;
  });

  it("says nothing about a mod the manifest does not name", async () => {
    const { answers } = await openPage([{ ...SURVEY, mod: undefined }]);
    expect(screen.queryByText(/Built for/)).not.toBeInTheDocument();
    await pressEscape();
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
    await pressEscape();
    await answers;
  });

  it("answers what is still open with Skip on Escape, and keeps what was chosen", async () => {
    const { answers } = await openPage([PLOTTER, SURVEY]);
    await press(rowButton("Load Plotter Uplink?", "Load"));
    await act(async () => {
      await pressEscape();
    });
    await expect(answers).resolves.toEqual([true, false]);
  });
});

describe("the first-load page on a station", () => {
  it("names every Uplink with no Skip or Load, and Continue loads them all", async () => {
    const { answers } = await openPage([
      { ...PLOTTER, onStation: true },
      { ...SURVEY, onStation: true },
    ]);
    expect(screen.getByText("Plotter Uplink")).toBeInTheDocument();
    expect(screen.getByText("Survey Uplink")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load" })).toBeNull();
    expect(screen.queryByText(/still to answer/)).toBeNull();
    await expectNoA11yViolations(document.body);

    await press(screen.getByRole("button", { name: "Continue" }));
    await expect(answers).resolves.toEqual([true, true]);
  });

  it("loads them all when Escape closes it", async () => {
    const { answers } = await openPage([{ ...PLOTTER, onStation: true }]);
    await act(async () => {
      await pressEscape();
    });
    await expect(answers).resolves.toEqual([true]);
  });
});

it("asks nothing about logs, which stay off until Settings turns them on", async () => {
  const { answers } = await openPage([PLOTTER]);
  expect(screen.queryByText(/anonymous/i)).not.toBeInTheDocument();
  expect(screen.getByText("1 still to answer")).toBeInTheDocument();
  await act(async () => {
    await pressEscape();
  });
  await answers;
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
    await pressEscape();
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
    await pressEscape();
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
    await pressEscape();
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
      await pressEscape();
    });
    await answers;

    expect(behind).not.toHaveAttribute("inert");
    expect(behind).not.toHaveAttribute("aria-hidden");
    behind.remove();
  });

  it("leaves the outer gate's isolation in place when it closes on top of it", async () => {
    const behind = document.createElement("div");
    document.body.append(behind);

    const outer = document.createElement("div");
    document.body.append(outer);
    const releaseOuter = isolateModal(outer);
    await waitFor(() => expect(behind).toHaveAttribute("inert"));

    const { answers } = await openPage([PLOTTER]);
    await press(rowButton("Load Plotter Uplink?", "Skip"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await answers;

    // The outer gate is still open, so the page must still be isolated.
    expect(behind).toHaveAttribute("inert");
    expect(behind).toHaveAttribute("aria-hidden", "true");

    releaseOuter();
    expect(behind).not.toHaveAttribute("inert");

    outer.remove();
    behind.remove();
  });
});
