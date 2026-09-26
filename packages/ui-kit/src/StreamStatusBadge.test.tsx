import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { StreamStatusBadge } from "./StreamStatusBadge";

describe("StreamStatusBadge", () => {
  it("keeps its live region mounted while the stream is live, so the first degradation is a change to it", () => {
    const { rerender } = render(<StreamStatusBadge status="live" />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();

    rerender(<StreamStatusBadge status="held-stale" />);

    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("STALE");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("carries one live region, not one per badge", () => {
    render(<StreamStatusBadge status="disconnected" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("has no axe violations live or degraded", async () => {
    const { container } = render(
      <>
        <StreamStatusBadge status="live" />
        <StreamStatusBadge status="absent" />
      </>,
    );
    await expectNoA11yViolations(container);
  });
});
