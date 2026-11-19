import {
  clearRegistry,
  type DataSource,
  type DataSourceStatus,
  registerDataSource,
} from "@ksp-gonogo/core";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RequiresGuard } from "./RequiresGuard";

function makeSitrepFixture(status: DataSourceStatus): DataSource {
  return {
    id: "sitrep",
    name: "Sitrep Stream",
    status,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    configSchema: () => [],
    getConfig: () => ({}),
    configure: () => {},
    onStatusChange: () => () => {},
  };
}

// A connected host by default; the host-down tests override it.
beforeEach(() => registerDataSource(makeSitrepFixture("connected")));

// Unmounted before clearRegistry(), which would otherwise re-render a mounted guard outside act().
const renderedTrees: Array<() => void> = [];
afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
});

function rosterPoint(
  uplinks: Array<{
    id: string;
    ownedPrefixes: string[];
    state: number;
    detail: string | null;
  }>,
) {
  return {
    uplinks: uplinks.map((u) => ({
      id: u.id,
      version: "1.0.0",
      available: true,
      reason: null,
      ownedPrefixes: u.ownedPrefixes,
      health: { state: u.state, detail: u.detail },
    })),
  };
}

function renderGuard(
  children: React.ReactNode,
  props: {
    heldOpenBy?: readonly "crash-ending"[];
    channels?: readonly string[];
    title?: string;
    awaitsFirstSignal?: boolean | { heading: string };
    compact?: { title: string };
  } = {},
) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const view = render(
    <TelemetryProvider client={client}>
      <RequiresGuard
        heldOpenBy={props.heldOpenBy}
        channels={props.channels}
        title={props.title}
        awaitsFirstSignal={props.awaitsFirstSignal}
        compact={props.compact}
      >
        {children}
      </RequiresGuard>
    </TelemetryProvider>,
  );
  renderedTrees.push(view.unmount);
  return { transport, ...view };
}

describe("RequiresGuard: uplink-health render-gate on REQUIRED channels", () => {
  it("renders children through when no channels are declared", () => {
    renderGuard(<div>widget content</div>);
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });

  it("renders children through while the owning uplink's health hasn't arrived yet", () => {
    renderGuard(<div>widget content</div>, { channels: ["demo.gauge.1"] });
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });

  it("blocks and shows the owning uplink's health.detail when it's degraded", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["demo.gauge.1"],
    });
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          {
            id: "demo",
            ownedPrefixes: ["demo."],
            state: 1,
            detail: "no active CPU selected",
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("no active CPU selected")).toBeInTheDocument(),
    );
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
  });

  it("renders children through once the owning uplink reports healthy", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["demo.gauge.1"],
    });
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          { id: "demo", ownedPrefixes: ["demo."], state: 0, detail: null },
        ]),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
  });

  it("has no axe violations while blocked on an unhealthy uplink", async () => {
    const { transport, container } = renderGuard(<div>widget content</div>, {
      channels: ["demo.gauge.1"],
    });
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          {
            id: "demo",
            ownedPrefixes: ["demo."],
            state: 2,
            detail: "backend down",
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("backend down")).toBeInTheDocument(),
    );
    await expectNoA11yViolations(container);
  });
});

/** The game at the Space Center with no active vessel: the mod sends every vessel Topic with no value. */
async function leaveFlight(
  transport: StubTransport,
  read: readonly string[] = ["ksp.activeVessel", "vessel.flight"],
) {
  // The stub delivers only to subscribed Topics, so the gate's reads must be in place first.
  await waitFor(() => {
    for (const topic of read) expect(transport.isSubscribed(topic)).toBe(true);
  });
  act(() => {
    transport.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    transport.emit("ksp.activeVessel", null as never);
    transport.emit("vessel.flight", null as never);
  });
}

describe("RequiresGuard: gated by the Topics a widget reads", () => {
  it("shows 'No active vessel' when its vessel Topic says there is none", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["vessel.flight"],
    });
    await leaveFlight(transport);
    await waitFor(() =>
      expect(screen.getByText("No active vessel")).toBeInTheDocument(),
    );
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
  });

  it("keeps the widget's name as the panel heading while the body is refused", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["vessel.flight"],
      title: "Orbit View",
    });
    await leaveFlight(transport);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Orbit View" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("No active vessel");
  });

  it("stays open while a vessel is active, even with a vessel Topic that has no value", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["vessel.target"],
    });
    act(() => {
      transport.emit("spaceCenter.scene", { scene: "Flight" });
      transport.emit("ksp.activeVessel", { vesselId: "probe" } as never);
      transport.emit("vessel.target", null as never);
    });
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No active vessel")).not.toBeInTheDocument();
  });

  it("does not gate on a vessel Topic that has not arrived yet", () => {
    renderGuard(<div>widget content</div>, { channels: ["vessel.flight"] });
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });

  it("leaves a widget that reads no vessel Topic alone with no vessel", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["trackingStation.bodies"],
    });
    await leaveFlight(transport, []);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });

  it("shows the career notice when a career Topic it reads has no value", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["career.status"],
    });
    act(() => {
      transport.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      transport.emit("career.status", null as never);
    });
    await waitFor(() =>
      expect(
        screen.getByText("Career or science save required"),
      ).toBeInTheDocument(),
    );
  });

  it("prioritises an unhealthy REQUIRED channel's message over the vessel gate", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["demo.gauge.1", "vessel.flight"],
    });
    await leaveFlight(transport);
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          {
            id: "demo",
            ownedPrefixes: ["demo."],
            state: 2,
            detail: "backend not selected",
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("backend not selected")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No active vessel")).not.toBeInTheDocument();
  });
});

describe("RequiresGuard: 'No telemetry host' takes priority when channels are declared", () => {
  it("shows 'No telemetry host' when the sitrep DataSource is disconnected", () => {
    clearRegistry();
    registerDataSource(makeSitrepFixture("disconnected"));
    renderGuard(<div>widget content</div>, { channels: ["demo.gauge.1"] });
    expect(screen.getByText("No telemetry host")).toBeInTheDocument();
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
  });

  it("renders children through when the host is connected but the roster hasn't arrived yet (genuine wait)", () => {
    renderGuard(<div>widget content</div>, { channels: ["demo.gauge.1"] });
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });

  it("does not gate on host status when the widget declares no channels at all", () => {
    clearRegistry();
    registerDataSource(makeSitrepFixture("disconnected"));
    renderGuard(<div>widget content</div>);
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });
});

describe("RequiresGuard: held open by the crash a flight ended in", () => {
  /** The craft flies and crashes, then the game leaves flight: the gate is engaged and the crash is on record. */
  const crashThenLeave = async (transport: StubTransport, held = true) => {
    if (held) {
      await waitFor(() =>
        expect(transport.isSubscribed("crash.lastCrash")).toBe(true),
      );
    }
    act(() => {
      transport.emit("spaceCenter.scene", { scene: "Flight" });
      transport.emit("vessel.identity", { vesselId: "doomed" } as never);
      transport.emit("crash.hasRecent", { recent: true });
      transport.emit("crash.lastCrash", { vesselId: "doomed", ut: 1000 });
    });
    await leaveFlight(transport);
    act(() => transport.emit("vessel.identity", null as never));
  };

  it("keeps a widget that declares it on screen once the game has left flight", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["vessel.flight"],
      heldOpenBy: ["crash-ending"],
    });
    await crashThenLeave(transport);
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No active vessel")).not.toBeInTheDocument();
  });

  it("leaves every other vessel widget behind the gate, crash on record or not", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["vessel.flight"],
    });
    await crashThenLeave(transport, false);
    await waitFor(() =>
      expect(screen.getByText("No active vessel")).toBeInTheDocument(),
    );
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
  });

  it("holds nothing open for a crash on record when no craft has been seen", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["vessel.flight"],
      heldOpenBy: ["crash-ending"],
    });
    act(() => {
      transport.emit("crash.hasRecent", { recent: true });
      transport.emit("crash.lastCrash", { vesselId: "long-ago", ut: 10 });
      transport.emit("vessel.identity", null as never);
    });
    await leaveFlight(transport);
    await waitFor(() =>
      expect(screen.getByText("No active vessel")).toBeInTheDocument(),
    );
  });
});

describe("RequiresGuard: a widget with nothing to draw until the link's first report", () => {
  it("shows the awaiting notice in place of the widget until the link reports", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      awaitsFirstSignal: true,
      title: "Crew Status",
    });
    expect(screen.getByText("Awaiting first signal")).toBeInTheDocument();
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();

    act(() => transport.emit("comms.link", { connected: true }));
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Awaiting first signal")).not.toBeInTheDocument();
  });

  it("passes a link reported down through, since that is an answer and not a wait", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      awaitsFirstSignal: true,
    });
    act(() => transport.emit("comms.link", { connected: false }));
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
  });

  it("leaves a widget that does not declare it alone while the link is pending", () => {
    renderGuard(<div>widget content</div>);
    expect(screen.getByText("widget content")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting first signal")).not.toBeInTheDocument();
  });

  it("keeps the widget's own heading rather than its registered name", () => {
    renderGuard(<div>widget content</div>, {
      awaitsFirstSignal: { heading: "COMMNET" },
      title: "CommNet Signal",
    });
    expect(screen.getByText("COMMNET")).toBeInTheDocument();
    expect(screen.queryByText("CommNet Signal")).not.toBeInTheDocument();
  });

  it("keeps only the tiny heading in a tiny tile, never part of the wording", () => {
    renderGuard(<div>widget content</div>, {
      awaitsFirstSignal: true,
      title: "CommNet Signal",
      compact: { title: "COMMNET" },
    });
    expect(screen.getByText("COMMNET")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting first signal")).not.toBeInTheDocument();
  });
});
