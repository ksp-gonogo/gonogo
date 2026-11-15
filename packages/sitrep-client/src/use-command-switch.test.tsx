import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { useCommand } from "./use-command";
import { ViewClock } from "./view-clock";

function Deploy() {
  const cmd = useCommand("deploy");
  return (
    <div>
      <button
        type="button"
        onClick={() => void cmd.dangerouslySendWithoutInput(1).catch(() => {})}
      >
        go
      </button>
      <span>
        phases:{cmd.inFlight.map((item) => item.predictedPhase).join(",")}
      </span>
    </div>
  );
}

/**
 * A screen whose mod keeps each craft's link in a lane of its own. A report's
 * `validAt` is when the craft's link was read and the frame it rides is
 * delivered at `at`, so a craft's kept report can be older than the newest one
 * from the craft just left.
 */
function setup() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport, undefined, { idPrefix: "t" });
  const store = new TimelineStore(
    new ViewClock({
      nowWall: createFakeWallClock().now,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  render(
    <TelemetryProvider client={client} store={store}>
      <Deploy />
    </TelemetryProvider>,
  );
  const emit = (topic: string, payload: unknown, validAt: number, at: number) =>
    act(() => {
      transport.emit(topic, payload, { validAt, deliveredAt: at });
      // The provider's frame loop, run by hand so each report is in the frame the next render reads.
      store.beginFrame();
    });
  emit(
    "system.uplinks",
    {
      delayRoles: {
        trueNow: [],
        heldAtHome: [],
        trueNowPrefixes: [],
        followsActiveCraft: ["comms.link"],
      },
    },
    0,
    0,
  );
  return {
    transport,
    link: (craft: string, connected: boolean, validAt: number, at = validAt) =>
      emit(
        "comms.link",
        { connected, meta: { source: `vessel:${craft}` } },
        validAt,
        at,
      ),
    active: (craft: string, at: number) =>
      emit("ksp.activeVessel", { vesselId: craft, name: craft }, at, at),
    /** The mod's queue holding the one command sent, dispatched at `dispatchedAt` with a 3 s delay each way. */
    pending: (dispatchedAt: number, at: number) =>
      emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "engine-1",
              clientRequestId: transport.sentCommands[0].requestId,
              command: "deploy",
              label: "",
              topic: "t",
              vantage: "ksc",
              dispatchedAt,
              oneWaySeconds: 3,
            },
          ],
        },
        at,
        at,
      ),
  };
}

function send(transport: StubTransport) {
  transport.holdCommands();
  fireEvent.click(screen.getByText("go"));
  expect(transport.sentCommands).toHaveLength(1);
}

describe("useCommand across a switch of active craft", () => {
  it("judges a command sent after the switch against the new craft's link, though the craft left has none", async () => {
    const s = setup();
    s.active("left", 0);
    s.link("left", false, 9);
    s.link("new", true, 5, 10);
    s.active("new", 10);

    send(s.transport);
    s.pending(10, 11);

    await waitFor(() =>
      expect(screen.getByText("phases:in-transit")).toBeTruthy(),
    );
  });

  it("judges a command sent after the switch as lost when the new craft has no link, though the craft left has one", async () => {
    const s = setup();
    s.active("left", 0);
    s.link("left", true, 9);
    s.link("new", false, 5, 10);
    s.active("new", 10);

    send(s.transport);
    s.pending(10, 11);

    await waitFor(() => expect(screen.getByText("phases:lost")).toBeTruthy());
  });

  it("does not take a report from the craft left, arriving after the switch, as a loss on the new craft", async () => {
    const s = setup();
    s.active("left", 0);
    s.link("left", true, 1);
    s.link("new", true, 5, 10);
    s.active("new", 10);

    send(s.transport);
    s.pending(10, 11);
    s.link("left", false, 11.5);
    s.pending(10, 12);

    await waitFor(() =>
      expect(screen.getByText("phases:in-transit")).toBeTruthy(),
    );
  });

  it("still marks a command lost when the active craft's own link drops", async () => {
    const s = setup();
    s.active("left", 0);
    s.link("left", true, 1);
    s.link("new", true, 5, 10);
    s.active("new", 10);

    send(s.transport);
    s.pending(10, 11);
    await waitFor(() =>
      expect(screen.getByText("phases:in-transit")).toBeTruthy(),
    );
    s.link("new", false, 12);

    await waitFor(() => expect(screen.getByText("phases:lost")).toBeTruthy());
  });
});
