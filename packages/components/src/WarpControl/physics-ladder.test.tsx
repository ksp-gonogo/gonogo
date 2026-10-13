import { fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it, vi } from "vitest";
import { isDisabled } from "../test/isDisabled";
import { WarpControlView, type WarpControlViewProps } from "./WarpControlView";

const base: WarpControlViewProps = {
  cols: 8,
  rows: 5,
  scene: "Flight",
  dimBody: false,
  currentRate: 4,
  mode: "Physics",
  currentIndex: 3,
  paused: false,
  alarmRequired: false,
  blockingDelay: null,
  oneWayDelay: null,
  nextAlarm: null,
  createAlarm: null,
  events: [],
  onSetWarp: vi.fn(),
  onTogglePause: vi.fn(),
  onOpenAlarms: vi.fn(),
};

describe("WarpControl in physics warp", () => {
  it("draws the four physics rungs and lights the one the published index names", () => {
    render(<WarpControlView {...base} />);
    const ladder = screen.getByRole("group", { name: "Time warp levels" });
    const labels = Array.from(ladder.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["1×", "2×", "3×", "4×"]);
    expect(
      screen.getByRole("button", { name: "4×" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("sends the physics index behind the rung pressed", () => {
    const onSetWarp = vi.fn();
    render(<WarpControlView {...base} onSetWarp={onSetWarp} />);
    fireEvent.click(screen.getByRole("button", { name: "2×" }));
    expect(onSetWarp).toHaveBeenCalledWith(1);
  });

  it("keeps the high ladder in high warp", () => {
    render(
      <WarpControlView
        {...base}
        mode="High"
        currentIndex={3}
        currentRate={50}
      />,
    );
    const ladder = screen.getByRole("group", { name: "Time warp levels" });
    expect(ladder.querySelectorAll("button")).toHaveLength(8);
  });

  it("stops the stepper at the top physics rung", () => {
    render(<WarpControlView {...base} cols={3} rows={3} />);
    expect(isDisabled(screen.getByRole("button", { name: "Warp up" }))).toBe(
      true,
    );
  });
});
