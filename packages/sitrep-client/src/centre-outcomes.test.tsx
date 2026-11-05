import { installTestHost } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { CommandDelay } from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider, useViewClockOptional } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { useCommand } from "./use-command";
import { ViewClock } from "./view-clock";

const COMMAND = "vessel.control.setRcs";

function setup() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport, undefined, { idPrefix: "t" });
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  function Provider({ children }: { children: React.ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }
  return { transport, Provider };
}

let dismissRef: ((id: string) => void) | undefined;

function Rcs() {
  const cmd = useCommand(COMMAND);
  dismissRef = cmd.dismiss;
  return (
    <div>
      <button
        type="button"
        onClick={() => void cmd.send({ enabled: true }).catch(() => {})}
      >
        rcs
      </button>
      <span>refusals:{cmd.refusals.map((r) => r.id).join(",")}</span>
      <span>inFlight:{cmd.inFlight.map((c) => c.id).join(",")}</span>
      <CommandDelay handle={cmd} />
    </div>
  );
}

function pendingEntry(clientRequestId: string, dispatchedAt: number) {
  return {
    id: `engine-${clientRequestId}`,
    clientRequestId,
    command: COMMAND,
    label: "Toggle RCS",
    topic: "",
    vantage: "ksc",
    dispatchedAt,
    oneWaySeconds: 5,
    members: [clientRequestId],
  };
}

function settledEntry(clientRequestId: string, settledAt: number) {
  return {
    id: `engine-${clientRequestId}`,
    clientRequestId,
    command: COMMAND,
    label: "Toggle RCS",
    topic: "",
    vantage: "ksc",
    settledAt,
    outcome: "refused",
    code: "notAvailable",
    reason: null,
    detail: null,
    message: null,
  };
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

let removeHost: (() => void) | undefined;
beforeEach(() => {
  removeHost = installTestHost({ useViewClockOptional });
});
afterEach(() => {
  removeHost?.();
  vi.restoreAllMocks();
  dismissRef = undefined;
});

describe("a refusal of this screen's own command, listed by the centre", () => {
  it("is shown once, and stays dismissed while the centre still lists it", async () => {
    const duplicateKeys = vi.spyOn(console, "error");
    const fixture = setup();
    render(
      <fixture.Provider>
        <Rcs />
      </fixture.Provider>,
    );
    const at = (ut: number) => ({ validAt: ut, deliveredAt: ut });
    act(() => {
      fixture.transport.emit("comms.link", { connected: true }, at(100));
    });

    fixture.transport.holdCommands();
    fireEvent.click(screen.getByText("rcs"));
    const [sent] = fixture.transport.sentCommands;
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        { pending: [pendingEntry(sent.requestId, 100)], settled: [] },
        at(101),
      );
    });

    // The refusal reaches the sender, and the centre lists it for every screen.
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: "notAvailable",
    }));
    fixture.transport.answerHeldCommands();
    await flush();
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        { pending: [], settled: [settledEntry(sent.requestId, 110)] },
        at(110),
      );
    });
    await flush();
    act(() => {
      fixture.transport.emit("comms.link", { connected: true }, at(111));
    });
    await flush();

    expect(screen.getByText(`refusals:${sent.requestId}`)).toBeTruthy();
    expect(
      duplicateKeys.mock.calls.some((call) =>
        String(call[0]).includes("same key"),
      ),
    ).toBe(false);

    act(() => dismissRef?.(sent.requestId));
    await flush();
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        { pending: [], settled: [settledEntry(sent.requestId, 110)] },
        at(120),
      );
    });
    await flush();
    expect(screen.getByText("refusals:")).toBeTruthy();
  });
});

describe("a refusal another screen's command met before this screen mounted", () => {
  it("is old news, even when the queue arrives before any other sample", async () => {
    const fixture = setup();
    render(
      <fixture.Provider>
        <Rcs />
      </fixture.Provider>,
    );
    // A reloaded screen: the first thing it hears is the queue, which still lists a refusal from UT 500.
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        { pending: [], settled: [settledEntry("station-ab12:c1", 500)] },
        { validAt: 800, deliveredAt: 800 },
      );
    });
    await flush();
    expect(screen.getByText("refusals:")).toBeTruthy();
  });

  it("is news when it reaches the centre after this screen first heard the game", async () => {
    const fixture = setup();
    render(
      <fixture.Provider>
        <Rcs />
      </fixture.Provider>,
    );
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        { pending: [], settled: [] },
        { validAt: 800, deliveredAt: 800 },
      );
    });
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        { pending: [], settled: [settledEntry("station-ab12:c1", 810)] },
        { validAt: 810, deliveredAt: 810 },
      );
    });
    await flush();
    expect(screen.getByText("refusals:station-ab12:c1")).toBeTruthy();
  });
});

describe("a group another screen sent", () => {
  it("is drawn on the rail of a control whose command is one of its members", async () => {
    const fixture = setup();
    render(
      <fixture.Provider>
        <Rcs />
      </fixture.Provider>,
    );
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              ...pendingEntry("station-ab12:g1", 800),
              command: "system.uplink.group",
              label: "Gear + Toggle RCS",
              members: ["station-ab12:g1", "station-ab12:g2"],
              memberCommands: ["vessel.control.setGear", COMMAND],
            },
          ],
          settled: [],
        },
        { validAt: 801, deliveredAt: 801 },
      );
    });
    await flush();
    expect(screen.getByText("inFlight:station-ab12:g1")).toBeTruthy();
  });

  it("lists a member the craft refused under that member's own command", async () => {
    const fixture = setup();
    render(
      <fixture.Provider>
        <Rcs />
      </fixture.Provider>,
    );
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        { pending: [], settled: [] },
        { validAt: 800, deliveredAt: 800 },
      );
    });
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        {
          pending: [],
          settled: [
            { ...settledEntry("station-ab12:g2", 810), id: "engine-g" },
          ],
        },
        { validAt: 810, deliveredAt: 810 },
      );
    });
    await flush();
    expect(screen.getByText("refusals:station-ab12:g2")).toBeTruthy();
  });
});
