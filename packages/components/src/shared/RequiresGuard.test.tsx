import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { RequiresGuard } from "./RequiresGuard";

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
    channels?: readonly string[];
  } = {},
) {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const view = render(
    <TelemetryProvider
      client={client}
      carriedChannels={["system.uplinks", "spaceCenter.scene", "career.mode"]}
    >
      <RequiresGuard requires={props.requires} channels={props.channels}>
        {children}
      </RequiresGuard>
    </TelemetryProvider>,
  );
  return { transport, ...view };
}

describe("RequiresGuard — uplink-health render-gate on REQUIRED channels", () => {
  it("renders children through when no channels are declared", () => {
    renderGuard(<div>widget content</div>);
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });

  it("renders children through while the owning uplink's health hasn't arrived yet", () => {
    renderGuard(<div>widget content</div>, { channels: ["kos.terminal.1"] });
    expect(screen.getByText("widget content")).toBeInTheDocument();
  });

  it("blocks and shows the owning uplink's health.detail when it's degraded", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      channels: ["kos.terminal.1"],
    });
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          {
            id: "kos",
            ownedPrefixes: ["kos."],
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
      channels: ["kos.terminal.1"],
    });
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          { id: "kos", ownedPrefixes: ["kos."], state: 0, detail: null },
        ]),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("widget content")).toBeInTheDocument(),
    );
  });

  it("has no axe violations while blocked on an unhealthy uplink", async () => {
    const { transport, container } = renderGuard(<div>widget content</div>, {
      channels: ["kos.terminal.1"],
    });
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          { id: "kos", ownedPrefixes: ["kos."], state: 2, detail: "no CPU" },
        ]),
      ),
    );
    await waitFor(() => expect(screen.getByText("no CPU")).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("RequiresGuard — merged with the existing game-context requires gate", () => {
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

  it("prioritises an unhealthy REQUIRED channel's message over an otherwise-satisfied requires gate", async () => {
    const { transport } = renderGuard(<div>widget content</div>, {
      requires: ["flight"],
      channels: ["kos.terminal.1"],
    });
    act(() => transport.emit("spaceCenter.scene", { scene: "Flight" }));
    act(() =>
      transport.emit(
        "system.uplinks",
        rosterPoint([
          {
            id: "kos",
            ownedPrefixes: ["kos."],
            state: 2,
            detail: "no CPU selected",
          },
        ]),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("no CPU selected")).toBeInTheDocument(),
    );
    expect(screen.queryByText("widget content")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Vessel in flight required"),
    ).not.toBeInTheDocument();
  });
});
