import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../expectNoA11yViolations";
import { visibleText } from "../testing";
import { SignalDelayBadge } from "./SignalDelayBadge";

describe("SignalDelayBadge", () => {
  it("reads the time to reach the other end, not the time to hear back", () => {
    /*
     * The semantic this component exists to fix. It used to say the round trip,
     * which answers when the acknowledgement gets back; the operator's question
     * is when their words land, and quoting eight minutes for a four-minute
     * crossing made the reading twice the number that mattered.
     */
    render(<SignalDelayBadge oneWaySeconds={3.8} />);
    expect(visibleText(screen.getByLabelText("Signal delay"))).toContain(
      "~3.8 s",
    );
  });

  it("keeps a decimal under a minute rather than truncating to a whole unit", () => {
    // A delay is a READOUT, not a countdown: the time ladder would show 7.6 s
    // as "7s" and lose the tenth that distinguishes two links.
    render(<SignalDelayBadge oneWaySeconds={7.6} />);
    expect(visibleText(screen.getByLabelText("Signal delay"))).toContain(
      "~7.6 s",
    );
  });

  it("lets the ladder take over above a minute", () => {
    // Past a minute the tenth is noise and a bare seconds count is unreadable.
    render(<SignalDelayBadge oneWaySeconds={240} />);
    const text = visibleText(screen.getByLabelText("Signal delay"));
    expect(text).not.toContain("240");
    expect(text).toContain("4");
  });

  it("announces politely rather than as an alert", () => {
    // A separation is a standing condition of the link, not an event worth
    // interrupting a screen reader mid-sentence for.
    render(<SignalDelayBadge oneWaySeconds={0.4} />);
    expect(screen.getByLabelText("Signal delay")).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("has no a11y violations", async () => {
    const { container } = render(<SignalDelayBadge oneWaySeconds={0.4} />);
    await expectNoA11yViolations(container);
  });
});
