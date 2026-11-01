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
    requires?: readonly ("flight" | "career")[];
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
        requires={props.requires}
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

describe("RequiresGuard: merged with the existing game-context requires gate", () => {
  it("still dims with the flight-required message when requires=['flight'] and scene isn't Flight", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
    });
    act(() => transport.emit("spaceCenter.scene", { scene: "SpaceCenter" }));
    await waitFor(() =>
      expect(screen.getByText("Vessel in flight required")).toBeInTheDocument(),
    );
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
  });

  it("keeps the widget's name as the panel heading while the body is refused", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
      title: "Contract Manager",
    });
    act(() => transport.emit("spaceCenter.scene", { scene: "SpaceCenter" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Contract Manager" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vessel in flight required",
    );
  });

  it("prioritises an unhealthy REQUIRED channel's message over an otherwise-satisfied requires gate", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
      channels: ["demo.gauge.1"],
    });
    act(() => transport.emit("spaceCenter.scene", { scene: "Flight" }));
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
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Vessel in flight required"),
    ).not.toBeInTheDocument();
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
  /** The game at the space centre first, the gate engaged and showing its notice, then the crash arrives. */
  const crashOnRecord = async (transport: StubTransport) => {
    act(() => transport.emit("spaceCenter.scene", { scene: "SpaceCenter" }));
    await screen.findByText("Vessel in flight required");
    act(() => {
      transport.emit("crash.hasRecent", { recent: true });
      transport.emit("crash.lastCrash", { vesselId: "doomed", ut: 1000 });
    });
  };

  it("keeps a widget that declares it on screen once the game has left the flight scene", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
      heldOpenBy: ["crash-ending"],
    });
    await crashOnRecord(transport);
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Vessel in flight required"),
    ).not.toBeInTheDocument();
  });

  it("leaves every other flight widget behind the gate, crash on record or not", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
    });
    await crashOnRecord(transport);
    await waitFor(() =>
      expect(screen.getByText("Vessel in flight required")).toBeInTheDocument(),
    );
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
  });

  it("holds nothing open without a crash on record", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
      heldOpenBy: ["crash-ending"],
    });
    act(() => transport.emit("spaceCenter.scene", { scene: "SpaceCenter" }));
    await waitFor(() =>
      expect(screen.getByText("Vessel in flight required")).toBeInTheDocument(),
    );
  });

  it("lets go once another vessel is the one reporting, so a new flight is not under the old crash", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
      heldOpenBy: ["crash-ending"],
    });
    await crashOnRecord(transport);
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
    act(() => transport.emit("vessel.identity", { vesselId: "next-craft" }));
    await waitFor(() =>
      expect(screen.getByText("Vessel in flight required")).toBeInTheDocument(),
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
