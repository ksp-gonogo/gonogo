import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { CommitLayer } from "./CommitLayer";

const gear = { on: false, phase: "idle", onToggle: vi.fn() };
const brakes = { on: false, phase: "idle", onToggle: vi.fn() };

const live = {
  regime: "live" as const,
  roundTripSeconds: 0,
  live: true,
  suicideBurnCountdown: 8,
  commitInSeconds: null,
  committed: false,
  blindInSeconds: null,
  blind: false,
  gear,
  brakes,
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

  it("surfaces the gear command lifecycle", () => {
    const { rerender } = render(
      <CommitLayer {...live} gear={{ ...gear, phase: "in-flight" }} />,
    );
    expect(screen.getByText("sending…")).toBeInTheDocument();
    rerender(
      <CommitLayer
        {...live}
        gear={{ ...gear, on: true, phase: "confirmed" }}
      />,
    );
    expect(screen.getByText("on")).toBeInTheDocument();
    rerender(<CommitLayer {...live} gear={{ ...gear, phase: "failed" }} />);
    expect(screen.getByText("no reply")).toBeInTheDocument();
  });

  it("fires the gear toggle on click", () => {
    const onToggle = vi.fn();
    render(<CommitLayer {...live} gear={{ ...gear, onToggle }} />);
    fireEvent.click(screen.getByRole("button", { name: /toggle gear/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = render(<CommitLayer {...live} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
