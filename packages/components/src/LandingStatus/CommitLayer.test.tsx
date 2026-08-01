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

  it("shows BURN LOCKED once the burn-GO deadline has passed under delay", () => {
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
    expect(screen.getByText("BURN LOCKED")).toBeInTheDocument();
  });

  // COMMIT POINT and UNCOMMANDABLE used to be asserted here, and the slot that
  // held them was asserted to reserve its own height so toggling it could not
  // reflow the widget. Both lines are gone: they stated the same fact in two
  // vocabularies (the round trip exceeds the window left), and the round trip
  // itself is now in the panel header, where the operator reads the arithmetic
  // rather than its conclusion twice. The reflow guarantee went with them,
  // there being no slot left to toggle.
  //
  // What survives from those tests is the live region, which is the part that
  // was never about the wording: a sustained delay state announces politely,
  // and only the instantaneous ignition cue is allowed to interrupt.
  it("announces a sustained delay state politely, not assertively", () => {
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
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent(/BURN LOCKED/i);
  });

  it("interrupts only for the ignition cue", () => {
    // The one ABORT-class event in this widget, per the a11y rule that reserves
    // assertive for events that must cut through.
    render(
      <CommitLayer {...live} roundTripSeconds={0} suicideBurnCountdown={0} />,
    );
    const region = screen.getByRole("alert");
    expect(region).toHaveAttribute("aria-live", "assertive");
    expect(region).toHaveTextContent(/IGNITE/i);
  });

  it("shows a landed state instead of stale descent countdowns once down", () => {
    render(
      <CommitLayer
        {...live}
        regime="autonomous"
        live={false}
        roundTripSeconds={4}
        suicideBurnCountdown={null}
        commitInSeconds={null}
        committed={false}
        blindInSeconds={50}
        blind={false}
        landed
      />,
    );
    expect(screen.getByText("LANDED")).toBeInTheDocument();
    expect(screen.getByText(/touchdown confirmed/i)).toBeInTheDocument();
    // No stale future "Blind in 50s" and no commit countdown once landed.
    expect(screen.queryByText(/Blind in/i)).toBeNull();
    expect(screen.queryByText(/COMMIT IN/i)).toBeNull();
    expect(screen.queryByText(/UNCOMMANDABLE/i)).toBeNull();
  });

  it("holds no command controls, Landing is an instrument, not a command surface", () => {
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
