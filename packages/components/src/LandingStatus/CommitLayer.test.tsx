import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { CommitLayer } from "./CommitLayer";

const live = {
  regime: "live" as const,
  roundTripSeconds: 0,
  live: true,
  suicideBurnCountdown: 8,
  commitInSeconds: null,
  committed: false,
  blindInSeconds: null,
  blind: false,
};

describe("CommitLayer", () => {
  it("shows the ignition countdown as the hero when live", () => {
    render(<CommitLayer {...live} />);
    expect(screen.getByText("SUICIDE BURN")).toBeInTheDocument();
  });

  it("shows COMMITTED once the commit clock has passed under delay", () => {
    render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        roundTripSeconds={16}
        commitInSeconds={-2}
        committed
      />,
    );
    expect(screen.getByText("COMMITTED")).toBeInTheDocument();
  });

  it("flags UNCOMMANDABLE when the round-trip exceeds the remaining burn window", () => {
    render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        roundTripSeconds={8.4}
        suicideBurnCountdown={3}
        commitInSeconds={-1.2}
        committed
      />,
    );
    expect(screen.getByText(/UNCOMMANDABLE/i)).toBeInTheDocument();
    // The mission-state banner is a polite live region.
    expect(screen.getByRole("status")).toHaveTextContent(/UNCOMMANDABLE/i);
  });

  it("holds no command controls — Landing is an instrument, not a command surface", () => {
    render(<CommitLayer {...live} />);
    // Gear/brakes are fired from the operator's own action-group widgets; the
    // commit layer must expose no toggle buttons of its own.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/configuration/i)).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = render(<CommitLayer {...live} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
