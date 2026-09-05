/**
 * The push-to-talk key, as an assistive technology and a keyboard find it.
 *
 * What only a render can show: that the key is a real button carrying a pressed
 * state, that the keyboard alone can latch and unlatch it, that a reason for a
 * dead key reaches the accessibility tree rather than only the eye, and that
 * nothing about a cut is announced to a listener.
 */
import { render, screen } from "@ksp-gonogo/test-utils";
import { createDelayRailStore, DelayRailContext } from "@ksp-gonogo/ui-kit";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RadioPtt } from "./RadioPtt";
import type { RadioControl } from "./useRadio";

function control(over: Partial<RadioControl> = {}): RadioControl {
  return {
    transmitting: false,
    opening: false,
    amplitudes: [],
    reception: {
      playing: null,
      live: [],
      backlogSeconds: 0,
      droppedChunks: 0,
    },
    unavailable: null,
    fault: null,
    toggle: () => {},
    isMuted: () => false,
    setMuted: () => {},
    ...over,
  };
}

describe("the push-to-talk key", () => {
  it("is a real button carrying its own pressed state", () => {
    const { rerender } = render(<RadioPtt radio={control()} />);
    const key = screen.getByRole("button", { name: "Transmit" });
    expect(key).toHaveAttribute("aria-pressed", "false");

    rerender(<RadioPtt radio={control({ transmitting: true })} />);
    expect(
      screen.getByRole("button", { name: "Stop transmitting" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("latches from the keyboard alone", async () => {
    /*
     * The reason it is a latch rather than hold-to-talk: press-and-hold has no
     * keyboard equivalent, `keydown` autorepeats and a Space or Enter `keyup`
     * is not guaranteed to pair with the press that started it.
     */
    const toggle = vi.fn();
    const user = userEvent.setup();
    render(<RadioPtt radio={control({ toggle })} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Transmit" })).toHaveFocus();
    await user.keyboard("[Space]");
    await user.keyboard("[Enter]");
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("announces transmitting, once, politely", () => {
    render(<RadioPtt radio={control({ transmitting: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Transmitting");
  });

  it("leaves reception to the transmission light, and announces none of it", () => {
    /*
     * The key is about this operator's own microphone. What is ARRIVING is
     * announced by the light, which is drawn in every view rather than only
     * inside a conversation: audio follows an explicit monitor, so a
     * transmission can land on a loop this composer is not for, and a second
     * region here would miss those and double-announce the rest.
     */
    render(
      <RadioPtt
        radio={control({
          reception: {
            playing: {
              transmissionId: "t1",
              from: "vessel:ares",
              authorName: "Jeb",
            },
            live: [],
            backlogSeconds: 0,
            droppedChunks: 0,
          },
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says nothing at all when nothing is happening", () => {
    // A listener cut off mid-word hears silence and is told nothing. Announcing
    // it would be the faster-than-light channel the delay model exists to avoid.
    render(<RadioPtt radio={control()} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("gives a dead key a reason an assistive technology can reach", () => {
    render(
      <RadioPtt radio={control({ unavailable: "Not a secure origin" })} />,
    );
    const key = screen.getByRole("button", { name: "Transmit" });
    expect(key).toBeDisabled();
    // The slice-0 split, on screen: an insecure origin is something the
    // operator can act on, a missing codec is not, and they must not read the
    // same. The LAN dev server puts a station in the first state every time.
    expect(screen.getByText("Not a secure origin").getAttribute("id")).toBe(
      key.getAttribute("aria-describedby"),
    );
  });

  it("reports a failed key without disabling it", () => {
    const { container } = render(
      <RadioPtt radio={control({ fault: "MIC DENIED" })} />,
    );
    expect(screen.getByRole("button", { name: "Transmit" })).toBeEnabled();
    expect(container).toHaveTextContent("MIC DENIED");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<RadioPtt radio={control()} />);
    await expectNoA11yViolations(container);
  });
});

describe("the voice crossing it publishes", () => {
  /**
   * The rail draws the operator's own voice from what this widget registers, so
   * a keyed transmitter that publishes nothing leaves the ribbon with no
   * producer and the rail silently empty.
   */
  it("registers a crossing while transmitting, carrying the captured loudness", () => {
    const store = createDelayRailStore();

    render(
      <DelayRailContext.Provider value={store}>
        <RadioPtt
          radio={control({ transmitting: true, amplitudes: [0.2, 0.6, 0.4] })}
          targetName="Odyssey"
          separationSeconds={1}
        />
      </DelayRailContext.Provider>,
    );

    const crossing = store.getActiveCrossings()[0];
    expect(crossing).toBeDefined();
    expect(crossing?.amplitudes).toEqual([0.2, 0.6, 0.4]);
    expect(crossing?.label).toContain("Odyssey");
    // Telemetry, continuous, fire-and-forget: a ribbon with no return leg.
    expect(crossing?.tags.delivery).toBe("fire-and-forget");
    expect(crossing?.tags.continuity).toBe("continuous");
  });

  it("registers nothing while idle, so the rail draws no ribbon", () => {
    const store = createDelayRailStore();

    render(
      <DelayRailContext.Provider value={store}>
        <RadioPtt
          radio={control({ transmitting: false, amplitudes: [] })}
          targetName="Odyssey"
          separationSeconds={1}
        />
      </DelayRailContext.Provider>,
    );

    expect(store.getActiveCrossings()).toHaveLength(0);
  });
});
