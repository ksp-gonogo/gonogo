import {
  ActionGroupComponent,
  AlarmsLauncherProvider,
} from "@ksp-gonogo/components";
import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function withItemContext(instanceId: string, children: ReactNode) {
  return (
    <DashboardItemContext.Provider value={{ instanceId }}>
      {children}
    </DashboardItemContext.Provider>
  );
}

/**
 * ActionGroup's READ path is the canonical `vessel.control` stream now, its
 * legacy `useTelemetry("data", group.value)` shim is gone, so these
 * integration tests drive the group's state through a real
 * `TelemetryProvider` + `TimelineStore` pipeline.
 *
 * The WRITE path is migrated too (command-surface-delay-audit): the toggle
 * fires `useCommand`, which dispatches straight through `TelemetryClient` to
 * the transport, so `stream.transport.sentCommands` is the write-path
 * assertion point.
 */
function makeControlStream() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const store = new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
  client.attachStore(store);

  /** Emits a `vessel.control` record. Stock's ten customs are always present. */
  function emitControl(patch: Record<string, unknown> = {}) {
    act(() => {
      transport.emit("vessel.control", {
        sasMode: 0,
        throttle: 0,
        actionGroups: Array.from({ length: 10 }, (_, i) => ({
          index: i + 1,
          name: `AG${i + 1}`,
          state: false,
        })),
        ...patch,
      });
      store.beginFrame();
    });
  }

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={new Set(["vessel.control"])}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { Provider, emitControl, transport };
}

/** One custom group's named-list entry, for an `emitControl` patch. */
function ag(index: number, state: boolean) {
  return {
    actionGroups: [{ index, name: `AG${index}`, state }],
  };
}

beforeEach(() => {
  clearRegistry();
});

describe("ActionGroup component", () => {
  it("shows placeholder when no action group is configured", () => {
    render(withItemContext("t", <ActionGroupComponent id="t" />));
    expect(screen.getByText("No action group configured")).toBeInTheDocument();
  });

  it("shows group name and OFF state on initial connect", async () => {
    const stream = makeControlStream();
    render(
      <stream.Provider>
        {withItemContext(
          "t",
          <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
        )}
      </stream.Provider>,
    );
    stream.emitControl(ag(1, false));

    expect(await screen.findByText("AG1")).toBeInTheDocument();
    expect(await screen.findByText("OFF")).toBeInTheDocument();
  });

  it("shows ON when the action group is already active", async () => {
    const stream = makeControlStream();
    render(
      <stream.Provider>
        {withItemContext(
          "t",
          <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
        )}
      </stream.Provider>,
    );
    stream.emitControl(ag(1, true));

    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("sends a toggle request and reflects the updated state", async () => {
    const user = userEvent.setup();
    const stream = makeControlStream();
    render(
      <stream.Provider>
        {withItemContext(
          "t",
          <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
        )}
      </stream.Provider>,
    );
    stream.emitControl(ag(1, false));

    expect(await screen.findByText("OFF")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /toggle ag1/i }));

    // The click dispatches the toggle via `useCommand`: an AGX/stock custom
    // (`group.index !== undefined`) always resolves to the shared
    // `setActionGroup` command, keyed by index and inverting the current state.
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setActionGroup",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ group: 1, state: true });
    });

    // KSP echoes the new state back on the READ channel the widget actually
    // watches. Emitted explicitly here because the echo now arrives on
    // `vessel.control`, not on the legacy `v.ag1Value` key the fake would have
    // flipped for us.
    stream.emitControl(ag(1, true));

    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("shows a disabled toggle for a read-only group (Precision Control)", async () => {
    const stream = makeControlStream();
    render(
      <stream.Provider>
        {withItemContext(
          "t",
          <ActionGroupComponent
            config={{ actionGroupId: "Precision Control" }}
            id="t"
          />,
        )}
      </stream.Provider>,
    );
    stream.emitControl({ precisionControl: false });

    expect(await screen.findByText("Precision Control")).toBeInTheDocument();
    // The state pill is now a toggle button at every size, but a read-only
    // group (no toggle action) renders it disabled so it can't be actioned.
    expect(
      screen.getByRole("button", { name: /toggle precision control/i }),
    ).toBeDisabled();
  });

  it("toggles SAS independently from AG1", async () => {
    const user = userEvent.setup();
    const stream = makeControlStream();
    render(
      <stream.Provider>
        {withItemContext(
          "t",
          <ActionGroupComponent config={{ actionGroupId: "SAS" }} id="t" />,
        )}
      </stream.Provider>,
    );
    stream.emitControl({ sas: false });

    expect(await screen.findByText("OFF")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /toggle sas/i }));

    // SAS is a stock singleton: its toggle resolves to the dedicated
    // `setSas` command, inverting the current (false) value.
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "vessel.control.setSas",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ enabled: true });
    });

    stream.emitControl({ sas: true });

    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("hides the alarm bell when no AlarmsLauncherProvider is mounted", async () => {
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );

    await waitFor(() => expect(screen.getByText("AG1")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /set alarm to fire ag1/i }),
    ).not.toBeInTheDocument();
  });

  it("invokes the alarms launcher with the group's toggle action when the bell is clicked", async () => {
    const user = userEvent.setup();
    const launcher = vi.fn();
    render(
      <AlarmsLauncherProvider launcher={launcher}>
        {withItemContext(
          "t",
          <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
        )}
      </AlarmsLauncherProvider>,
    );

    await waitFor(() => expect(screen.getByText("AG1")).toBeInTheDocument());
    await user.click(
      screen.getByRole("button", { name: /set alarm to fire ag1/i }),
    );
    expect(launcher).toHaveBeenCalledWith({
      name: "Fire AG1",
      action: "f.ag1",
    });
  });

  it("hides the bell on read-only groups (Precision Control has no toggle action)", async () => {
    const launcher = vi.fn();
    render(
      <AlarmsLauncherProvider launcher={launcher}>
        {withItemContext(
          "t",
          <ActionGroupComponent
            config={{ actionGroupId: "Precision Control" }}
            id="t"
          />,
        )}
      </AlarmsLauncherProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("Precision Control")).toBeInTheDocument(),
    );
    // No bell: without a toggle action there's nothing for the alarm to
    // dispatch, so the affordance is suppressed.
    expect(
      screen.queryByRole("button", { name: /set alarm to fire/i }),
    ).not.toBeInTheDocument();
  });
});
