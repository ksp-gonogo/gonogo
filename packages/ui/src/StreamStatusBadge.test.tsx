import type { StreamStatusValue } from "@ksp-gonogo/sitrep-client";
import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { formatStreamStatus, StreamStatusBadge } from "./StreamStatusBadge";

const STATUS_TO_LABEL: Record<StreamStatusValue, string | null> = {
  live: null,
  "held-stale": "STALE",
  // Stale asks the operator to check the producer; blackout asks them to wait and stop reading the panel as current.
  "last-before-blackout": "BLACKOUT",
  // A replayed recording is exact for its instant, so "STALE" would claim uncertainty it does not have.
  recorded: "RECORDED",
  disconnected: "OFFLINE",
  resyncing: "SYNCING",
  absent: "NO DATA",
};

describe("formatStreamStatus", () => {
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
  it('draws no badge for "live", leaving only its empty live region', () => {
    render(<StreamStatusBadge status="live" />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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
