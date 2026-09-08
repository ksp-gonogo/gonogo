import {
  act,
  clearActionHandlers,
  render as rtlRender,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  renderWidget,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
// Side-effect import: the widget self-registers on module load, and
// `renderWidget` looks it up by id rather than importing the component.
import "./index";

/**
 * MechJeb is a command surface with no telemetry identity of its own, so the
 * test runs it off the real stream pipeline (`setupStreamFixture` →
 * `TelemetryProvider`/`TelemetryClient`/`StubTransport`) and asserts the three
 * commands dispatch with the right envelope + args, and that each command's
 * lifecycle (in-flight → confirmed) surfaces on its row, with no module mocks.
 */

const COMMANDS = [
  "mechjeb.engageAscentAutopilot",
  "mechjeb.executeNextNode",
  "mechjeb.landAtTarget",
];
const CARRIED = ["comms.delay", "system.uplinks", ...COMMANDS];

const renderedTrees: Array<() => void> = [];
function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function renderMechJeb(defaultAscentAltitudeKm = 100) {
  const fixture = setupStreamFixture({ carriedChannels: CARRIED });
  // The delay-rail store, the item context and the rest of the dashboard's
  // stack all come from `renderWidget`, which mounts them in GridItemContent's
  // own order rather than this test reproducing a subset of it.
  const view = renderWidget("mechjeb", {
    instanceId: "mj",
    config: { defaultAscentAltitudeKm },
    wrapper: fixture.Provider,
  });
  return { fixture, view };
}

describe("MechJeb command widget", () => {
  it("renders the three autopilot command buttons and the ascent-altitude input", () => {
    renderMechJeb();
    expect(
      screen.getByRole("button", { name: /engage ascent autopilot/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /execute next node/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /land at target/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/target altitude \(km\)/i),
    ).toBeInTheDocument();
  });

  it("writes the one-way delay into the subtitle rather than a dash", async () => {
    const { fixture, view } = renderMechJeb();
    act(() => {
      fixture.emit("comms.delay", { source: 1, oneWaySeconds: 750 });
    });
    // The NUMBER, not just the sentence around it. `oneWaySeconds` arrives as a
    // `Value<"s">`, and re-wrapping one in `value("s", ...)` builds a value
    // whose magnitude is an object, which every formatter renders as the null
    // dash: a Duna-distance link then reads exactly like no delay model at all.
    await waitFor(() => {
      expect(visibleText(view.container)).toContain("12min 30s one-way delay");
    });
  });

  it("dispatches execute-next-node with an empty arg on click", async () => {
    const { fixture } = renderMechJeb();
    await userEvent.click(
      screen.getByRole("button", { name: /execute next node/i }),
    );
    await waitFor(() =>
      expect(
        fixture.transport.sentCommands.some(
          (c) => c.command === "mechjeb.executeNextNode",
        ),
      ).toBe(true),
    );
  });

  it("dispatches engage-ascent with the target altitude the operator set", async () => {
    const { fixture } = renderMechJeb(100);
    const input = screen.getByLabelText(/target altitude \(km\)/i);
    await userEvent.clear(input);
    await userEvent.type(input, "180");
    await userEvent.click(
      screen.getByRole("button", { name: /engage ascent autopilot/i }),
    );
    await waitFor(() => {
      const cmd = fixture.transport.sentCommands.find(
        (c) => c.command === "mechjeb.engageAscentAutopilot",
      );
      expect(cmd).toBeDefined();
      expect(
        (cmd?.args as { targetAltitudeKm?: number }).targetAltitudeKm,
      ).toBe(180);
    });
  });

  it('refuses to engage on a blank altitude rather than flying the 0 that Number("") gives', async () => {
    const { fixture } = renderMechJeb(100);
    const input = screen.getByLabelText(/target altitude \(km\)/i);
    await userEvent.clear(input);

    // The absence render: the widget SAYS it has no altitude rather than
    // drawing the confident 0 a numeric state would have held.
    expect(
      screen.getByText(/no target altitude read from the field/i),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    // And the engage is not merely visually discouraged: nothing reaches the
    // wire, by click or by a bound serial/keyboard input, because MechJeb
    // would fly whatever number arrives.
    const button = screen.getByRole("button", {
      name: /engage ascent autopilot/i,
    });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    await act(async () => {});
    expect(
      fixture.transport.sentCommands.some(
        (c) => c.command === "mechjeb.engageAscentAutopilot",
      ),
    ).toBe(false);
  });

  it("refuses an explicit zero, which is not an orbit", async () => {
    const { fixture } = renderMechJeb(100);
    const input = screen.getByLabelText(/target altitude \(km\)/i);
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    expect(
      screen.getByRole("button", { name: /engage ascent autopilot/i }),
    ).toBeDisabled();
    await act(async () => {});
    expect(
      fixture.transport.sentCommands.some(
        (c) => c.command === "mechjeb.engageAscentAutopilot",
      ),
    ).toBe(false);
  });

  it("recovers once a real altitude is typed back in", async () => {
    const { fixture } = renderMechJeb(100);
    const input = screen.getByLabelText(/target altitude \(km\)/i);
    await userEvent.clear(input);
    await userEvent.type(input, "180");

    expect(
      screen.queryByText(/no target altitude read from the field/i),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /engage ascent autopilot/i }),
    );
    await waitFor(() => {
      const cmd = fixture.transport.sentCommands.find(
        (c) => c.command === "mechjeb.engageAscentAutopilot",
      );
      expect(cmd).toBeDefined();
      expect(
        (cmd?.args as { targetAltitudeKm?: number }).targetAltitudeKm,
      ).toBe(180);
    });
  });

  it("surfaces the command lifecycle on the row (confirmed after the stub answers)", async () => {
    renderMechJeb();
    await userEvent.click(
      screen.getByRole("button", { name: /land at target/i }),
    );
    // StubTransport answers the command-request on a later microtask, so the
    // land row's status chip resolves to confirmed.
    expect(await screen.findByText(/confirmed/i)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { view } = renderMechJeb();
    await expectNoA11yViolations(view.container);
  });
});

/**
 * The mod side goes inert whenever MechJeb2 is absent or the version guard
 * finds its API drifted (including a version it could not read at all), and
 * registers no command handlers in that state. These emissions are the raw
 * roster the engine builds; the widget reads the derived `system.uplinkHealth`
 * over it, so each of them also proves the fixture's store derives that
 * channel at all.
 */
describe("MechJeb2 not reachable", () => {
  /** Matches the C# `UplinkHealthState` arms by value, not by name. */
  const HEALTHY = 0;
  const UNAVAILABLE = 2;

  function emitRoster(
    fixture: ReturnType<typeof renderMechJeb>["fixture"],
    state: number,
    detail: string | null = null,
  ) {
    act(() => {
      fixture.emit("system.uplinks", {
        uplinks: [
          {
            id: "mechjeb",
            version: "0.1.0",
            available: state !== UNAVAILABLE,
            reason: detail,
            ownedPrefixes: [],
            health: { state, detail, facts: [] },
          },
        ],
      });
    });
  }

  it("says so, with the guard's own reason, and takes all three commands dead", async () => {
    const { fixture } = renderMechJeb();
    emitRoster(fixture, UNAVAILABLE, "MechJeb2 assembly version unreadable");

    expect(
      await screen.findByText(/MECHJEB NOT REACHABLE/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/MechJeb2 assembly version unreadable/),
    ).toBeInTheDocument();

    for (const name of [
      /engage ascent autopilot/i,
      /execute next node/i,
      /land at target/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }

    // Not merely greyed: a bound serial or keyboard input calls the same fire
    // path and never sees `disabled`, so nothing reaches the wire either way.
    await userEvent.click(
      screen.getByRole("button", { name: /land at target/i }),
    );
    await act(async () => {});
    expect(fixture.transport.sentCommands).toHaveLength(0);
  });

  it("stays quiet and live on a healthy roster", async () => {
    const { fixture } = renderMechJeb();
    emitRoster(fixture, HEALTHY);

    await act(async () => {});
    expect(
      screen.queryByText(/MECHJEB NOT REACHABLE/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /land at target/i }),
    ).not.toBeDisabled();
  });

  it("stays quiet and live before the roster arrives, because not knowing is not unavailable", async () => {
    renderMechJeb();

    await act(async () => {});
    expect(
      screen.queryByText(/MECHJEB NOT REACHABLE/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /execute next node/i }),
    ).not.toBeDisabled();
  });
});

describe("MechJeb in-flight indicator (surfaces in the Panel delay rail)", () => {
  it("appears on dispatch, reveals the command when pinned, and clears once the command resolves", async () => {
    const { fixture } = renderMechJeb();

    await userEvent.click(
      screen.getByRole("button", { name: /execute next node/i }),
    );
    const requestId = await waitFor(() => {
      const sent = fixture.transport.sentCommands.find(
        (c) => c.command === "mechjeb.executeNextNode",
      );
      expect(sent).toBeDefined();
      return sent?.requestId as string;
    });

    // From here on, once a row is showing, `InFlightList`'s `useCountdown`
    // keeps a real 1 Hz interval ticking for as long as it's mounted. Under
    // real timers that tick is a live background race against this test's
    // own remaining async steps: on a loaded machine (e.g. the full
    // monorepo test run) the interval can fire between renders with no
    // `act()` in scope, which is a real "not wrapped in act" bug in the
    // TEST, not the component (see ManeuverPlanner's own
    // `shouldAdvanceTime` countdown test for the same pattern). Fake timers
    // make every tick happen only where we ask for it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Echo it into the pending queue: dispatchedAt/oneWaySeconds anchor
      // the in-flight window; validAt/deliveredAt also anchor useUtNow to
      // 100.
      act(() => {
        fixture.emit(
          "system.uplink.pending",
          {
            pending: [
              {
                id: requestId,
                command: "mechjeb.executeNextNode",
                label: "Execute next node",
                topic: "",
                vantage: "ksc",
                dispatchedAt: 100,
                oneWaySeconds: 4,
              },
            ],
          },
          { validAt: 100, deliveredAt: 100 },
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      // The delay UX now surfaces in the Panel's delay rail (the first in-flow
      // child of the body scroller, above the header), not as an inline body
      // child: this is what the usePanelDelay migration moves. Collapsed, the
      // rail is a glow-strip SUMMARY (accessible name "In-flight commands: N in
      // flight", no per-command text) and the delay-ux-v3 redesign conveys the
      // countdown by the glow's position, not a "Ns" string; the command's own
      // label is revealed only when the rail is pinned open.
      const rail = screen.getByLabelText(/In-flight commands/);
      expect(rail.closest("[data-panel-rail]")).not.toBeNull();

      // Pin the rail open to reveal the per-command queue, then confirm THIS
      // command is the one in flight (its label rides the listitem's name).
      act(() => {
        (
          screen.getByRole("button", {
            name: /signal-delay detail/i,
          }) as HTMLButtonElement
        ).click();
      });
      expect(
        screen.getByRole("listitem", { name: /Execute next node/ }),
      ).toBeInTheDocument();

      // Advance nowUt past the reply (dispatchedAt + 2*oneWaySeconds = 108)
      // with the path connected throughout -> resolves ("due") and clears.
      act(() => {
        fixture.emit(
          "system.uplink.pending",
          {
            pending: [
              {
                id: requestId,
                command: "mechjeb.executeNextNode",
                label: "Execute next node",
                topic: "",
                vantage: "ksc",
                dispatchedAt: 100,
                oneWaySeconds: 4,
              },
            ],
          },
          { validAt: 109, deliveredAt: 109 },
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(
        screen.queryByLabelText(/In-flight commands/),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
