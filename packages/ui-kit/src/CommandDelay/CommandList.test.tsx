import {
  CommandErrorCode,
  railTagsForCommand,
  railTagsForControlAxis,
} from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { emittedRuleFor } from "../test/emittedRule";
import { CommandList } from "./CommandList";
import type { RailFailed } from "./commandFailedSentence";
import type { RailFound } from "./commandFoundSentence";
import type { RailLoss } from "./commandLossSentence";
import {
  commandRefusalSentence,
  type RailRefusal,
} from "./commandRefusalSentence";
import type { RailUndelivered } from "./commandUndeliveredSentence";

// The rail axes come from the production derivations, so the fixtures follow them rather than asserting stale literals.
const DISCRETE = railTagsForCommand("vessel.control.setSasMode");
const CONTINUOUS = railTagsForControlAxis("vessel.control.setAxes");

const refusal: RailRefusal = {
  id: "r0",
  errorCode: CommandErrorCode.LimitReached,
  command: "vessel.control.stage",
  tags: railTagsForCommand("vessel.control.stage"),
};

const loss: RailLoss = {
  id: "c0",
  command: "vessel.control.setSas",
  args: { enabled: true },
  label: "",
  tags: DISCRETE,
};

const unsent: RailUndelivered = { ...loss };

const broke: RailFailed = { ...loss };

const found: RailFound = { ...loss, outcome: "ran" };

describe("CommandList", () => {
  it("names each kind for assistive tech by default", () => {
    render(
      <>
        <CommandList kind="refused" entries={[refusal]} />
        <CommandList kind="lost" entries={[loss]} />
        <CommandList kind="undelivered" entries={[unsent]} />
        <CommandList kind="found" entries={[found]} />
        <CommandList kind="failed" entries={[broke]} />
      </>,
    );
    for (const name of [
      "Refused commands",
      "Commands with no reply",
      "Commands that were never sent",
      "Unconfirmed commands that answered",
      "Commands that failed",
    ]) {
      expect(screen.getByRole("status", { name })).toBeTruthy();
    }
  });

  it("says each kind's own sentence", () => {
    render(
      <>
        <CommandList kind="refused" entries={[refusal]} />
        <CommandList kind="lost" entries={[{ ...loss, id: "l" }]} />
        <CommandList kind="undelivered" entries={[{ ...unsent, id: "u" }]} />
        <CommandList kind="found" entries={[{ ...found, id: "f" }]} />
        <CommandList kind="failed" entries={[{ ...broke, id: "x" }]} />
      </>,
    );
    expect(
      screen.getByRole("status", { name: "Refused commands" }),
    ).toHaveTextContent(commandRefusalSentence(refusal));
    expect(
      screen.getByRole("status", { name: "Commands with no reply" }),
    ).toHaveTextContent("Set Sas: no reply. May have run.");
    expect(
      screen.getByRole("status", { name: "Commands that were never sent" }),
    ).toHaveTextContent("Set Sas: never sent. Safe to re-send.");
    expect(
      screen.getByRole("status", {
        name: "Unconfirmed commands that answered",
      }),
    ).toHaveTextContent("Set Sas: found executed after being lost.");
    expect(
      screen.getByRole("status", { name: "Commands that failed" }),
    ).toHaveTextContent("Set Sas: failed, with no verdict from the game.");
  });

  it("draws a warning kind's command identity in the colour made for text on a dark ground", () => {
    render(<CommandList kind="lost" entries={[loss]} />);
    const [glyph] = screen.getAllByText("SAS");
    expect(emittedRuleFor(glyph)).toContain("var(--color-warn-text)");
  });

  it("draws a found in the notice colour, since it reports something that happened", () => {
    render(<CommandList kind="found" entries={[found]} />);
    const [glyph] = screen.getAllByText("SAS");
    expect(emittedRuleFor(glyph)).toContain("var(--color-info-text)");
  });

  it("spells a continuous command's name out rather than drawing a glyph tile", () => {
    render(
      <CommandList kind="lost" entries={[{ ...loss, tags: CONTINUOUS }]} />,
    );
    expect(screen.getByText("Set Sas")).toBeTruthy();
  });

  it("announces an entry that arrives after the list is on screen", () => {
    const { rerender } = render(<CommandList kind="refused" entries={[]} />);
    const region = screen.getByRole("status", { name: "Refused commands" });
    expect(region).toBeEmptyDOMElement();

    rerender(<CommandList kind="refused" entries={[refusal]} />);

    expect(screen.getByRole("status", { name: "Refused commands" })).toBe(
      region,
    );
    expect(region).toHaveTextContent(commandRefusalSentence(refusal));
  });

  it("announces politely and each new entry on its own, never assertively", () => {
    // Polite: assertive is reserved for ABORT.
    render(<CommandList kind="found" entries={[found]} />);
    const region = screen.getByRole("status", { name: /answered/i });
    expect(region.getAttribute("aria-live")).not.toBe("assertive");
    expect(region).toHaveAttribute("aria-atomic", "false");
  });

  it("is a plain list when something else announces it, and draws nothing empty", () => {
    const { container, rerender } = render(
      <CommandList kind="lost" entries={[loss]} live={false} />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("list", { name: "Commands with no reply" }),
    ).toBeTruthy();

    rerender(<CommandList kind="lost" entries={[]} live={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("carries no clear control when nothing can dismiss", () => {
    render(<CommandList kind="undelivered" entries={[unsent]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dismisses by the dispatch's own requestId", async () => {
    const user = userEvent.setup();
    const cleared: string[] = [];
    render(
      <CommandList
        kind="found"
        entries={[found]}
        onDismiss={(id) => cleared.push(id)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Dismiss Set Sas/i }));
    expect(cleared).toEqual(["c0"]);
  });

  it("names the gesture for a dispatch with no subject at all, per kind", () => {
    render(
      <>
        <CommandList
          kind="refused"
          entries={[
            { id: "a", errorCode: CommandErrorCode.WrongState, tags: DISCRETE },
          ]}
          onDismiss={() => {}}
        />
        <CommandList
          kind="lost"
          entries={[{ id: "b", tags: DISCRETE }]}
          onDismiss={() => {}}
        />
        <CommandList
          kind="undelivered"
          entries={[{ id: "c", tags: DISCRETE }]}
          onDismiss={() => {}}
        />
        <CommandList
          kind="found"
          entries={[{ id: "d", outcome: "ran", tags: DISCRETE }]}
          onDismiss={() => {}}
        />
      </>,
    );
    for (const name of [
      "Dismiss refusal",
      "Dismiss unconfirmed command",
      "Dismiss unsent command",
      "Dismiss found command",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("takes a caller's name for the list", () => {
    render(
      <CommandList kind="refused" entries={[refusal]} ariaLabel="Refusals" />,
    );
    expect(screen.getByRole("status", { name: "Refusals" })).toBeTruthy();
  });

  it("has no axe violations live, plain, empty, and with a clear control", async () => {
    const { container } = render(
      <>
        <CommandList kind="refused" entries={[refusal]} />
        <CommandList kind="lost" entries={[]} />
        <CommandList
          kind="found"
          entries={[found]}
          live={false}
          onDismiss={() => {}}
        />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
