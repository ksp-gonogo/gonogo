import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { LevelBars } from "./LevelBars";

describe("LevelBars", () => {
  it("draws one bar per step and says how many are lit", () => {
    const { container } = render(<LevelBars lit={2} of={4} label="Signal" />);
    expect(
      screen.getByRole("img", { name: "Signal 2 of 4" }),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-level-bars]")?.children).toHaveLength(
      4,
    );
  });

  it("says zero lit as a verdict and a null count as unknown", () => {
    const { unmount } = render(<LevelBars lit={0} of={4} />);
    expect(screen.getByRole("img", { name: "0 of 4" })).toBeInTheDocument();
    unmount();
    render(<LevelBars lit={null} of={4} />);
    expect(screen.getByRole("img", { name: "unknown" })).toBeInTheDocument();
  });
});
