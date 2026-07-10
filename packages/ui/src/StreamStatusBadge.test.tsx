import type { StreamStatusValue } from "@ksp-gonogo/sitrep-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatStreamStatus, StreamStatusBadge } from "./StreamStatusBadge";
import { axe } from "./test/axe";

const STATUS_TO_LABEL: Record<StreamStatusValue, string | null> = {
  live: null,
  "held-stale": "STALE",
  "last-before-blackout": "STALE",
  disconnected: "OFFLINE",
  resyncing: "SYNCING",
  absent: "NO DATA",
};

describe("formatStreamStatus", () => {
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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
