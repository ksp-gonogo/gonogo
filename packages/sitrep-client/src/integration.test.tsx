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
   * Written to settle a specific accusation: a channel recorded zero frames in
   * a 20 s live capture where `vessel.orbit` delivered, and an enumeration of
   * the mod's emission path narrowed the cause to "no subscriber", leaving
   * open whether the spine propagates a subscription for a derived channel's
   * input at all. It does. The assertions below fail if that stops being true,
   * on the whole chain (provider, client, ref-count, transport) rather than on
   * `resolveSubscriptionTopics` in isolation, which is where the existing
   * coverage stops.
   *
   * The example was `vessel.maneuver.legacy` until that channel was retired.
   * What is under test is the subscription propagation, not the channel, so it
   * moved to one that is still derived.
   */
  it("a derived-topic read opens a wire subscription for its input, not for its own name", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    function OrbitPatchesProbe() {
      const patches = useStream<{ referenceBody: string }[]>(
        "vessel.state.orbitPatches",
      );
      // The patch's own body, not a count: a count reads the same whether the
      // derivation ran or handed back an array of nothing.
      return (
        <span>
          patches:
          {patches?.map((p) => p.referenceBody).join(",") ?? NULL_DISPLAY}
        </span>
      );
    }

    const { unmount } = render(
      <TelemetryProvider client={client}>
        <OrbitPatchesProbe />
      </TelemetryProvider>,
    );

    expect(transport.isSubscribed("vessel.orbit")).toBe(true);
    // Nothing publishes either of these, so a subscription to one is a
    // subscription to silence.
    expect(transport.isSubscribed("vessel.state")).toBe(false);
    expect(transport.isSubscribed("vessel.state.orbitPatches")).toBe(false);

    // `StubTransport.emit` is subscription-gated, so delivery here is itself
    // the proof the wire subscription is real rather than bookkeeping.
    act(() => {
      transport.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        // A whole patch, because `mapOrbitPatch` reads every field: a partial
        // one throws inside the derivation and renders nothing, which is not
        // the failure this test is looking for.
        patches: [
          {
            sma: 700_000,
            ecc: 0,
            inc: 0,
            lan: 0,
            argPe: 0,
            meanAnomalyAtEpoch: 0,
            epoch: 0,
            period: 1800,
            startUt: 0,
            endUt: 1800,
            patchStartTransition: 0,
            patchEndTransition: 0,
            peA: 100_000,
            apA: 100_000,
            semiLatusRectum: 700_000,
            semiMinorAxis: 700_000,
            referenceBody: "Kerbin",
          },
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/patches:Kerbin/)).toBeTruthy(),
    );

    unmount();
    expect(transport.isSubscribed("vessel.orbit")).toBe(false);
  });
});
