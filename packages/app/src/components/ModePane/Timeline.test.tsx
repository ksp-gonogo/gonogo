import type { ModeTimeline } from "@ksp-gonogo/sitrep-sdk";
import { fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";

describe("Timeline", () => {
  it("moves the mode to the moment dragged to or the mark pressed, in mission time", async () => {
    const seek = vi.fn();
    const timeline: ModeTimeline = {
      start: 1_000,
      end: 1_400,
      at: 1_112,
      launchUt: 1_000,
      seek,
      marks: [{ ut: 1_058, label: "1" }],
    };
    const { container } = render(<Timeline timeline={timeline} />);
    expect(screen.getByText("T+1min 52s")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Timeline" }), {
      target: { value: "1200" },
    });
    expect(seek).toHaveBeenLastCalledWith(1_200);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(seek).toHaveBeenLastCalledWith(1_058);
    await expectNoA11yViolations(container);
  });

  it("plays a recording back, with its rate and a way out", () => {
    const play = vi.fn();
    const exit = vi.fn();
    const setRate = vi.fn();
    render(
      <Timeline
        timeline={{
          start: 100,
          end: 254,
          at: 161,
          seek: () => {},
          playback: {
            playing: false,
            rate: 1,
            rates: [0.5, 1, 2],
            play,
            pause: () => {},
            setRate,
            exit,
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play replay" }));
    expect(play).toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Playback rate" }), {
      target: { value: "2" },
    });
    expect(setRate).toHaveBeenLastCalledWith(2);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Exit replay and return to live data",
      }),
    );
    expect(exit).toHaveBeenCalled();
  });

  it("says why there is nothing to move through while there is no timeline", () => {
    render(<Timeline timeline={undefined} empty="No predicted run" />);
    expect(screen.getByText("No predicted run")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
