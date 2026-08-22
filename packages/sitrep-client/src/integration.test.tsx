import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { CommandDelay, NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import type { LegacyManeuverNode } from "./maneuver-legacy";
import { StubTransport } from "./stub-transport";
import { useCommand } from "./use-command";
import { useStream } from "./use-stream";

/**
 * Proof that one component can read a live telemetry stream
 * AND dispatch a command, both routed through the real
 * `TelemetryProvider` -> `TelemetryClient` -> `Transport` boundary, with only
 * the transport's other end (`StubTransport`) faked.
 */
function MissionPanel() {
  const altitude = useStream<number>("v.alt");
  const cmd = useCommand("stage");
  return (
    <div>
      <span>altitude:{altitude ?? NULL_DISPLAY}</span>
      <button type="button" onClick={() => cmd.send()}>
        stage
      </button>
      <span>phase:{cmd.status.phase}</span>
      <CommandDelay handle={cmd} />
    </div>
  );
}

describe("sitrep-client end-to-end spine", () => {
  it("streams live data and runs a command to confirmed through the real provider/client/stub", async () => {
    const transport = new StubTransport();
    transport.setCommandHandler((command) => ({ command, staged: true }));
    const client = new TelemetryClient(transport);

    const { unmount } = render(
      <TelemetryProvider client={client}>
        <MissionPanel />
      </TelemetryProvider>,
    );

    // Stream: renders, then updates on new inbound data. `TelemetryProvider`
    // coalesces `beginFrame()` to the next animation frame, so each update
    // lands one frame after its emit, not synchronously.
    expect(screen.getByText(`altitude:${NULL_DISPLAY}`)).toBeTruthy();
    act(() => {
      transport.emit("v.alt", 1200);
    });
    await waitFor(() => expect(screen.getByText("altitude:1200")).toBeTruthy());
    act(() => {
      transport.emit("v.alt", 1450);
    });
    await waitFor(() => expect(screen.getByText("altitude:1450")).toBeTruthy());

    // Command: idle -> in-flight (observable synchronously right after the
    // click, before the stub's queued microtask response) -> confirmed.
    expect(screen.getByText("phase:idle")).toBeTruthy();
    fireEvent.click(screen.getByText("stage"));
    expect(screen.getByText("phase:in-flight")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("phase:confirmed")).toBeTruthy(),
    );

    // Unmount releases the ref-counted stream subscription: the transport
    // should no longer consider "v.alt" subscribed.
    expect(transport.isSubscribed("v.alt")).toBe(true);
    unmount();
    expect(transport.isSubscribed("v.alt")).toBe(false);
  });

  /**
   * Reading a DERIVED topic must open a wire subscription for its declared
   * input, because no server channel ever publishes the derived name and a
   * caller that subscribed to it verbatim would wait forever.
   *
   * Written to settle a specific accusation: `vessel.maneuver` recorded zero
   * frames in a 20 s live capture where `vessel.orbit` delivered, and an
   * enumeration of the mod's emission path narrowed the cause to "no
   * subscriber", leaving open whether the spine propagates a subscription
   * for `vessel.maneuver.legacy`'s input at all. It does. The assertions
   * below fail if that ever stops being true, on the whole chain (provider,
   * client, ref-count, transport) rather than on `resolveSubscriptionTopics`
   * in isolation, which is where the existing coverage stops.
   */
  it("a derived-topic read opens a wire subscription for its input, not for its own name", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function ManeuverProbe() {
      const nodes = useStream<LegacyManeuverNode[]>(
        "vessel.maneuver.legacy.nodes",
      );
      // The node's own UT, not a count: a count reads the same whether the
      // reshape ran or handed back an array of nothing.
      return (
        <span>nodes:{nodes?.map((n) => n.UT).join(",") ?? NULL_DISPLAY}</span>
      );
    }

    const { unmount } = render(
      <TelemetryProvider client={client}>
        <ManeuverProbe />
      </TelemetryProvider>,
    );

    expect(transport.isSubscribed("vessel.maneuver")).toBe(true);
    // Nothing publishes either of these, so a subscription to one is a
    // subscription to silence.
    expect(transport.isSubscribed("vessel.maneuver.legacy")).toBe(false);
    expect(transport.isSubscribed("vessel.maneuver.legacy.nodes")).toBe(false);

    // `StubTransport.emit` is subscription-gated, so delivery here is itself
    // the proof the wire subscription is real rather than bookkeeping.
    act(() => {
      transport.emit("vessel.maneuver", {
        nodes: [
          {
            id: "node-1",
            ut: 1200,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 850,
            patches: [],
          },
        ],
      });
    });
    await waitFor(() => expect(screen.getByText("nodes:1200")).toBeTruthy());

    unmount();
    expect(transport.isSubscribed("vessel.maneuver")).toBe(false);
  });
});
