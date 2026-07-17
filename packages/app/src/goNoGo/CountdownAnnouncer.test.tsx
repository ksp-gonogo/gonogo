import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { CountdownAnnouncer } from "./GoNoGoComponent";

/**
 * Exercises the sr-only announcer without needing the surrounding PeerClient /
 * GoNoGoHost / useScreen context. The announcer takes only `secondsLeft` and
 * only announces at discrete milestones (T-10, T-5, T-3, T-2, T-1, T-0).
 */
describe("CountdownAnnouncer", () => {
  it("announces T minus 10 exactly when crossing into the 10-second milestone", () => {
    const { rerender } = render(<CountdownAnnouncer secondsLeft={11} />);
    // At 11s there's no milestone to announce yet — the status span is empty.
    expect(screen.getByRole("status").textContent).toBe("");

    rerender(<CountdownAnnouncer secondsLeft={10} />);
    expect(screen.getByRole("status").textContent).toBe("T minus 10");
  });

  it("announces T zero at the terminal milestone", () => {
    const { rerender } = render(<CountdownAnnouncer secondsLeft={1} />);
    expect(screen.getByRole("status").textContent).toBe("T minus 1");
    rerender(<CountdownAnnouncer secondsLeft={0} />);
    expect(screen.getByRole("status").textContent).toBe("T zero");
  });

  it("does not re-announce the same milestone on sub-second ticks", () => {
    const { rerender } = render(<CountdownAnnouncer secondsLeft={5} />);
    expect(screen.getByRole("status").textContent).toBe("T minus 5");
    // Slipping below 5 into 4.x should not re-trigger T minus 5 (announcement
    // guard ref), and 4.x has no milestone of its own so the last announcement
    // remains visible until we cross T minus 3.
    rerender(<CountdownAnnouncer secondsLeft={4.8} />);
    expect(screen.getByRole("status").textContent).toBe("T minus 5");
  });
});
