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
      live: [],
      backlogSeconds: 0,
      droppedChunks: 0,
    },
    unavailable: null,
    fault: null,
    toggle: () => {},
    isMuted: () => false,
    setMuted: () => {},
    inputDeviceId: null,
    setInputDevice: () => {},
    ...over,
  };
}

describe("the push-to-talk key", () => {
  it("is a real button carrying its own pressed state", () => {
    const { rerender } = render(<RadioPtt radio={control()} />);
    const key = screen.getByRole("button", { name: "Talk" });
    expect(key).toHaveAttribute("aria-pressed", "false");

    rerender(<RadioPtt radio={control({ transmitting: true })} />);
    expect(screen.getByRole("button", { name: "Talk" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps one name, and one width, through every state it has", () => {
    /*
     * The label used to read "Talk" and then "On air", which is two words of
     * different width on a control an operator presses twice in a row: the
     * second press lands where the first one was and the button has moved out
     * from under the pointer. It is also a rename in the accessibility tree at
     * the exact instant the state changes, which is what `aria-pressed` is for.
     *
     * Asserted over every state the key has rather than the two obvious ones,
     * because the opening state is the one that got a third name.
     */
    const states: Partial<RadioControl>[] = [
      {},
      { transmitting: true },
      { opening: true },
      { fault: "MIC DENIED" },
      { unavailable: "Not a secure origin" },
    ];
    for (const state of states) {
      const { unmount } = render(<RadioPtt radio={control(state)} />);
      const named = screen.getAllByRole("button", { name: "Talk" });
      expect(named, JSON.stringify(state)).toHaveLength(1);
      expect(named[0]).toHaveTextContent(/^Talk$/);
      unmount();
    }
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
    expect(screen.getByRole("button", { name: "Talk" })).toHaveFocus();
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
            live: [
              {
                transmissionId: "t1",
                threadKey: "vessel:ares",
                with: ["vessel:ares"],
                from: "vessel:ares",
                authorName: "Jeb",
                muted: false,
              },
            ],
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
    const key = screen.getByRole("button", { name: "Talk" });
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
    expect(screen.getByRole("button", { name: "Talk" })).toBeEnabled();
    expect(container).toHaveTextContent("MIC DENIED");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<RadioPtt radio={control()} />);
    await expectNoA11yViolations(container);
  });
});

describe("the voice ribbon it publishes", () => {
  /** The single ribbon on the panel's one registered handle. */
  const ribbon = (store: ReturnType<typeof createDelayRailStore>) =>
    store.getActiveHandles()[0]?.ribbons?.[0];

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

    const handle = store.getActiveHandles()[0];
    expect(handle).toBeDefined();
    /* A stream handle, which is the one claim a transmission can honestly make:
       everything a command carries is omitted rather than sent as an empty. */
    expect(handle?.shape).toBe("stream");
    expect(handle?.inFlight).toEqual([]);
    expect(handle?._output).toBeUndefined();
    /* And it names its own graph, so the rail does not call the operator's
       voice "Delay detail". */
    expect(handle?.ariaLabel).toContain("Odyssey");
    const crossing = ribbon(store);
    expect(crossing).toBeDefined();
    expect(crossing?.amplitudes).toEqual([0.2, 0.6, 0.4]);
    expect(crossing?.label).toContain("Odyssey");
    /* One second of light-time is fifty 20 ms chunks: how many samples fit in
       the gap, and the one number the render harness reads back through
       `crossingSpanSamples` rather than restating. */
    expect(crossing?.spanSamples).toBe(50);
    /* Telemetry, continuous, fire-and-forget: a ribbon with no return leg, and
       the rail's own default for a ribbon, so the widget states none of it. */
    expect(crossing?.tags).toBeUndefined();
    expect(crossing?.oneWaySeconds).toBe(1);
  });

  /**
   * A vessel in low orbit is under a millisecond away, so the gap holds a
   * FRACTION of one 20 ms chunk. That fraction is what goes to the rail.
   *
   * It used to be floored at 1, and the floor was the second defect: the rail
   * limits its turning points to the samples actually behind them, and told the
   * gap held a whole sample it drew a confident full-width sawtooth off two of
   * them, identical for every transmission at low orbit and saying nothing.
   */
  it("passes the real fraction of a chunk for a sub-millisecond separation", () => {
    const store = createDelayRailStore();

    render(
      <DelayRailContext.Provider value={store}>
        <RadioPtt
          radio={control({ transmitting: true, amplitudes: [0.2, 0.6] })}
          targetName="Odyssey"
          separationSeconds={0.0007}
        />
      </DelayRailContext.Provider>,
    );

    expect(ribbon(store)?.spanSamples).toBeCloseTo(0.035, 6);
  });

  /**
   * No separation to convert is not a separation of zero. The prop's documented
   * fallback is the retained ring's own length, which the rail applies for
   * itself when the span is absent, so the widget passes nothing rather than
   * scaling the trace against a gap it cannot measure.
   */
  it("passes no span at all when there is no separation to convert", () => {
    const store = createDelayRailStore();

    render(
      <DelayRailContext.Provider value={store}>
        <RadioPtt
          radio={control({ transmitting: true, amplitudes: [0.2, 0.6] })}
          targetName="Odyssey"
          separationSeconds={null}
        />
      </DelayRailContext.Provider>,
    );

    expect(ribbon(store)?.spanSamples).toBeUndefined();
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

    expect(store.getActiveHandles()).toHaveLength(0);
  });
});
