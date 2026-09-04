import type { StreamStatusValue } from "@ksp-gonogo/sitrep-client";
import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { formatStreamStatus, StreamStatusBadge } from "./StreamStatusBadge";

const STATUS_TO_LABEL: Record<StreamStatusValue, string | null> = {
  live: null,
  "held-stale": "STALE",
  // Its own word too, and for the operator's sake rather than the value's:
  // "STALE" is a reading whose updates stopped arriving, and this is the last
  // one that got out before the craft went behind something. The first asks
  // you to go and look at the producer; the second asks you to wait, and to
  // stop reading the panel as the state of the craft now.
  "last-before-blackout": "BLACKOUT",
  // Its own word: a replayed recording is exact for the instant it names, so
  // "STALE" would claim uncertainty the value does not have.
  recorded: "RECORDED",
  disconnected: "OFFLINE",
  resyncing: "SYNCING",
  absent: "NO DATA",
};

describe("formatStreamStatus", () => {
  // The two blackout grades used to share one caption, so a panel could not
  // say whether data was being WITHHELD or whether the craft had gone dark.
  it("does not collapse the two blackout grades onto one caption", () => {
    expect(formatStreamStatus("held-stale")).not.toBe(
      formatStreamStatus("last-before-blackout"),
    );
  });

  for (const [status, label] of Object.entries(STATUS_TO_LABEL)) {
    it(`maps "${status}" -> ${label === null ? "null (no badge)" : `"${label}"`}`, () => {
      expect(formatStreamStatus(status as StreamStatusValue)).toBe(label);
    });
  }
});

describe("StreamStatusBadge", () => {
  it('renders nothing for "live"', () => {
    const { container } = render(<StreamStatusBadge status="live" />);
    expect(container).toBeEmptyDOMElement();
  });

  for (const [status, label] of Object.entries(STATUS_TO_LABEL)) {
    if (label === null) continue;
    it(`renders "${label}" as a status/aria-live badge for "${status}"`, () => {
      render(<StreamStatusBadge status={status as StreamStatusValue} />);
      const node = screen.getByRole("status");
      expect(node).toHaveTextContent(label);
      expect(node).toHaveAttribute("aria-live", "polite");
    });
  }

  it("has no axe violations across every non-live status", async () => {
    const { container } = render(
      <>
        <StreamStatusBadge status="held-stale" />
        <StreamStatusBadge status="last-before-blackout" />
        <StreamStatusBadge status="disconnected" />
        <StreamStatusBadge status="resyncing" />
        <StreamStatusBadge status="absent" />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
