import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { CommandDelay, usePanelDelay } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { LOSS_MARGIN, TelemetryClient } from "./client";
import type { Clock } from "./clock";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import type { Transport, TransportStatus } from "./transport";
import { useCommand } from "./use-command";
import { ViewClock } from "./view-clock";

function Deploy() {
  const cmd = useCommand("deploy");
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          // Fire-and-forget from a click handler, same as most real
          // dispatch call sites; `status` is what the test observes, not
          // the promise, but it still must be caught to avoid an unhandled
          // rejection when a command loses/errors.
          cmd.send(9).catch(() => {});
        }}
      >
        go
      </button>
      <span>phase:{cmd.status.phase}</span>
      <span>
        eta:{cmd.status.phase === "in-flight" ? cmd.status.etaConfirm : "none"}
      </span>
      {/* Satisfies the must-consume invariant: every dispatch handle needs a
          mounted <CommandDelay>. Draws nothing here (no delay). */}
      <CommandDelay handle={cmd} />
    </div>
  );
}

/** See client.test.ts for the identical double: kept local here so this
 * test file stays self-contained. */
class FakeClock implements Clock {
  private currentUt: number;
  private pending: { atUt: number; fn: () => void; cancelled: boolean }[] = [];

  constructor(startUt = 0) {
    this.currentUt = startUt;
  }

  now(): number {
    return this.currentUt;
  }

  schedule(atUt: number, fn: () => void): () => void {
    const callback = { atUt, fn, cancelled: false };
    this.pending.push(callback);
    return () => {
      callback.cancelled = true;
    };
  }

  advanceTo(ut: number): void {
    this.currentUt = ut;
    const due = this.pending.filter((cb) => !cb.cancelled && cb.atUt <= ut);
    this.pending = this.pending.filter((cb) => cb.cancelled || cb.atUt > ut);
    for (const cb of due) cb.fn();
  }
}

class EtaTransport implements Transport {
  readonly status: TransportStatus = "connected";
  private readonly messageListeners = new Set<
    (message: ServerMessage) => void
  >();

  constructor(private readonly eta: number | undefined) {}

  predictConfirmEta(): number | undefined {
    return this.eta;
  }

  send(): void {
    // Test drives responses manually (none needed for these loss tests).
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(): () => void {
    return () => {};
  }
}

describe("useCommand", () => {
  it("fires a command and reflects the lifecycle to confirmed", async () => {
    const t = new StubTransport();
    t.setCommandHandler((c, a) => ({ c, a }));
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    expect(screen.getByText("phase:idle")).toBeTruthy();
    fireEvent.click(screen.getByText("go"));
    await waitFor(() =>
      expect(screen.getByText("phase:confirmed")).toBeTruthy(),
    );
  });

  it("surfaces the predicted etaConfirm while in-flight", () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("eta:4")).toBeTruthy();
  });

  it("surfaces lost after silence past etaConfirm + LOSS_MARGIN", () => {
    const clock = new FakeClock(0);
    const transport = new EtaTransport(4);
    const client = new TelemetryClient(transport, clock);
    render(
      <TelemetryProvider client={client}>
        <Deploy />
      </TelemetryProvider>,
    );
    fireEvent.click(screen.getByText("go"));

    // clock.advanceTo synchronously fires the loss-inference callback,
    // which synchronously updates the store: same as any direct
    // setState-driving call, this needs an explicit act() (fireEvent
    // wraps this automatically; a bare test-double clock advance doesn't).
    act(() => {
      clock.advanceTo(4 + LOSS_MARGIN);
    });

    expect(screen.getByText("phase:lost")).toBeTruthy();
  });
});

// ── inFlight: this hook's own accumulated dispatch set ───────────────────

/**
 * Local, self-contained stream fixture: same `FixedViewClock` +
 * `StubTransport` pattern `use-route-commands.test.tsx` uses (sitrep-client
 * can't depend on `@ksp-gonogo/components`' `setupStreamFixture`, which
 * sits above it in the dependency graph).
 */
function setupFixture() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  const carriedChannels = ["comms.link", "system.uplink.pending"];

  function Provider({ children }: { children: React.ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={carriedChannels}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, client, store, wall, Provider };
}

function DeployWithInFlight() {
  const cmd = useCommand("deploy");
  return (
    <div>
      <button type="button" onClick={() => void cmd.send(1).catch(() => {})}>
        go1
      </button>
      <button type="button" onClick={() => void cmd.send(2).catch(() => {})}>
        go2
      </button>
      <span>count:{cmd.inFlight.length}</span>
      <span>
        phases:{cmd.inFlight.map((item) => item.predictedPhase).join(",")}
      </span>
      <CommandDelay handle={cmd} />
    </div>
  );
}

describe("useCommand inFlight", () => {
  it(
    "accumulates concurrent dispatches, drops one once past reply under a " +
      "connected path, and retains a comms-dropped one as lost even after " +
      "the queue ages it out",
    async () => {
      const fixture = setupFixture();
      render(
        <fixture.Provider>
          <DeployWithInFlight />
        </fixture.Provider>,
      );

      // Anchor nowUt at 0 and record an initial connected observation.
      act(() => {
        fixture.transport.emit(
          "comms.link",
          { connected: true },
          { validAt: 0, deliveredAt: 0 },
        );
      });

      fireEvent.click(screen.getByText("go1"));
      fireEvent.click(screen.getByText("go2"));
      expect(fixture.transport.sentCommands).toHaveLength(2);
      const [r1id, r2id] = fixture.transport.sentCommands.map(
        (c) => c.requestId,
      );

      // r1: short window [0,4]. r2: long window [0,12]. Both present, both
      // still in-transit at nowUt 0.
      act(() => {
        fixture.transport.emit(
          "system.uplink.pending",
          {
            pending: [
              {
                id: r1id,
                command: "deploy",
                label: "",
                topic: "t",
                vantage: "ksc",
                dispatchedAt: 0,
                oneWaySeconds: 2,
              },
              {
                id: r2id,
                command: "deploy",
                label: "",
                topic: "t",
                vantage: "ksc",
                dispatchedAt: 0,
                oneWaySeconds: 6,
              },
            ],
          },
          { validAt: 0, deliveredAt: 0 },
        );
      });
      await waitFor(() =>
        expect(screen.getByText("phases:in-transit,in-transit")).toBeTruthy(),
      );

      // Advance nowUt to 5 (past r1's reply at 4, before r2's reach at 6),
      // path still connected throughout [0,4] -> r1 resolves ("due") and
      // drops; r2 stays in-transit.
      act(() => {
        fixture.transport.emit(
          "system.uplink.pending",
          {
            pending: [
              {
                id: r1id,
                command: "deploy",
                label: "",
                topic: "t",
                vantage: "ksc",
                dispatchedAt: 0,
                oneWaySeconds: 2,
              },
              {
                id: r2id,
                command: "deploy",
                label: "",
                topic: "t",
                vantage: "ksc",
                dispatchedAt: 0,
                oneWaySeconds: 6,
              },
            ],
          },
          { validAt: 5, deliveredAt: 5 },
        );
      });
      await waitFor(() =>
        expect(screen.getByText("phases:in-transit")).toBeTruthy(),
      );
      expect(screen.getByText("count:1")).toBeTruthy();

      // Drop the path at nowUt 8: inside r2's [0,12] window.
      // classifyRetained's `lost` check evaluates pathConnectedDuring over
      // the FULL fixed window, so this reclassifies r2 as lost immediately
      // (not merely once nowUt reaches the reply), a stronger failure
      // signal than lateness, per the design's no-path/lost distinction.
      act(() => {
        fixture.transport.emit(
          "comms.link",
          { connected: false },
          { validAt: 8, deliveredAt: 8 },
        );
      });
      await waitFor(() => expect(screen.getByText("phases:lost")).toBeTruthy());

      // r2 ages out of the queue entirely (nowUt 20, past its reply at
      // 12): retained anyway (own-dispatch memory) and stays classified
      // "lost" because the path was down somewhere inside its [0,12] window.
      act(() => {
        fixture.transport.emit(
          "system.uplink.pending",
          { pending: [] },
          { validAt: 20, deliveredAt: 20 },
        );
      });
      await waitFor(() => expect(screen.getByText("phases:lost")).toBeTruthy());
      expect(screen.getByText("count:1")).toBeTruthy();
    },
  );

  it("degrades gracefully: a dispatch that never gets a queue entry drops after the never-tracked grace window", async () => {
    const fixture = setupFixture();
    render(
      <fixture.Provider>
        <DeployWithInFlight />
      </fixture.Provider>,
    );

    act(() => {
      fixture.transport.emit(
        "comms.link",
        { connected: true },
        { validAt: 0, deliveredAt: 0 },
      );
    });

    fireEvent.click(screen.getByText("go1"));
    // No queue entry has arrived yet, nothing classified to show, but the
    // dispatch is still tracked internally (within the grace window).
    expect(screen.getByText("count:0")).toBeTruthy();

    // No system.uplink.pending entry ever arrives for this dispatch (a
    // live/no-delay path): advance nowUt well past the grace window
    // without ever emitting a matching queue entry. The dispatch drops out
    // of tracking instead of leaking forever; observable here only as
    // "still nothing shown, no crash, no stray entry"; see
    // resolveTracked's "expired" branch for the internal prune.
    act(() => {
      fixture.transport.emit(
        "comms.link",
        { connected: true },
        { validAt: 10, deliveredAt: 10 },
      );
    });
    await waitFor(() => expect(screen.getByText("count:0")).toBeTruthy());
  });
});

// ── must-consume invariant (dev): a dispatch needs usePanelDelay (the panel-
// rail path) or an inline <CommandDelay>, either of which consumes the token ──

describe("useCommand must-consume invariant (dev)", () => {
  function makeClient() {
    const transport = new StubTransport();
    transport.setCommandHandler((c, a) => ({ c, a }));
    return new TelemetryClient(transport);
  }

  function Unlock({ withDelay }: { withDelay: boolean }) {
    const cmd = useCommand("career.tech.unlock");
    return (
      <div>
        <button
          type="button"
          onClick={() => void cmd.send({ id: "n" }).catch(() => {})}
        >
          unlock
        </button>
        {withDelay ? <CommandDelay handle={cmd} /> : null}
      </div>
    );
  }

  it("throws in dev when a command is dispatched without usePanelDelay or a CommandDelay", () => {
    render(
      <TelemetryProvider client={makeClient()}>
        <Unlock withDelay={false} />
      </TelemetryProvider>,
    );
    expect(() => {
      fireEvent.click(screen.getByText("unlock"));
    }).toThrow(/usePanelDelay/);
  });

  function UnlockViaPanelDelay() {
    const cmd = useCommand("career.tech.unlock");
    // The panel-rail path: usePanelDelay consumes the token even with no delay
    // store in the tree (a headerless / no-Panel test), so a dispatch is allowed.
    usePanelDelay(cmd);
    return (
      <button
        type="button"
        onClick={() => void cmd.send({ id: "n" }).catch(() => {})}
      >
        unlock
      </button>
    );
  }

  it("does not throw when usePanelDelay(cmd) is called (the panel-rail path)", () => {
    render(
      <TelemetryProvider client={makeClient()}>
        <UnlockViaPanelDelay />
      </TelemetryProvider>,
    );
    expect(() => {
      fireEvent.click(screen.getByText("unlock"));
    }).not.toThrow();
  });

  it("does not throw when <CommandDelay handle={cmd}> is mounted", () => {
    render(
      <TelemetryProvider client={makeClient()}>
        <Unlock withDelay={true} />
      </TelemetryProvider>,
    );
    expect(() => {
      fireEvent.click(screen.getByText("unlock"));
    }).not.toThrow();
  });
});

function DeployWithDismiss() {
  const cmd = useCommand("deploy");
  return (
    <div>
      <button type="button" onClick={() => void cmd.send(1).catch(() => {})}>
        go
      </button>
      <button
        type="button"
        onClick={() => {
          const first = cmd.inFlight[0];
          if (first) cmd.dismiss(first.id);
        }}
      >
        dismiss
      </button>
      <span>count:{cmd.inFlight.length}</span>
      <CommandDelay handle={cmd} />
    </div>
  );
}

describe("useCommand dismiss", () => {
  it("dismiss(id) clears a retained command from inFlight", async () => {
    const fixture = setupFixture();
    render(
      <fixture.Provider>
        <DeployWithDismiss />
      </fixture.Provider>,
    );
    act(() => {
      fixture.transport.emit(
        "comms.link",
        { connected: true },
        { validAt: 0, deliveredAt: 0 },
      );
    });
    fireEvent.click(screen.getByText("go"));
    const [rid] = fixture.transport.sentCommands.map((c) => c.requestId);
    act(() => {
      fixture.transport.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: rid,
              command: "deploy",
              label: "",
              topic: "t",
              vantage: "ksc",
              dispatchedAt: 0,
              oneWaySeconds: 6,
            },
          ],
        },
        { validAt: 0, deliveredAt: 0 },
      );
    });
    await waitFor(() => expect(screen.getByText("count:1")).toBeTruthy());
    fireEvent.click(screen.getByText("dismiss"));
    await waitFor(() => expect(screen.getByText("count:0")).toBeTruthy());
  });
});
