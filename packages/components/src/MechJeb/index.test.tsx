import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { MechJebComponent } from "./index";

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
const CARRIED = ["comms.delay", ...COMMANDS];

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
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "mj" }}>
        <MechJebComponent config={{ defaultAscentAltitudeKm }} id="mj" />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
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
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("MechJeb in-flight indicator (useCommand().inFlight folded in)", () => {
  it("appears on dispatch, shows a countdown, and clears once the command resolves", async () => {
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
    // own remaining async steps — on a loaded machine (e.g. the full
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

      const list = screen.getByLabelText("Execute next node — in flight");
      expect(list).toHaveTextContent("Execute next node");
      expect(list).toHaveTextContent("4s");

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
        screen.queryByLabelText("Execute next node — in flight"),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
