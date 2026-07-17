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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeTelemachusHandle,
  setupFakeTelemachus,
} from "./fixtures/fakeTelemachus";

function withItemContext(instanceId: string, children: ReactNode) {
  return (
    <DashboardItemContext.Provider value={{ instanceId }}>
      {children}
    </DashboardItemContext.Provider>
  );
}

/**
 * ActionGroup's READ path is the canonical `vessel.control` stream now — its
 * legacy `useDataValue("data", group.value)` shim is gone — so these
 * integration tests drive the group's state through a real
 * `TelemetryProvider` + `TimelineStore` pipeline.
 *
 * The legacy `fakeTelemachus` fixture is still mounted alongside, because the
 * WRITE path is unchanged: `useExecuteAction("data")` still fires `f.ag1` at
 * the `DataSource` (`vessel.control.setActionGroup` isn't in `carriedChannels`
 * here, so `mapCommand` deliberately falls back to legacy). That split — reads
 * off the stream, writes still legacy — is exactly the widget's real shape at
 * this point in the migration, so the test mirrors it rather than faking
 * either half.
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

  return { Provider, emitControl };
}

/** One custom group's named-list entry, for an `emitControl` patch. */
function ag(index: number, state: boolean) {
  return {
    actionGroups: [{ index, name: `AG${index}`, state }],
  };
}

let fake: FakeTelemachusHandle | null = null;

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  fake?.buffered.disconnect();
  fake = null;
});

describe("ActionGroup component", () => {
  it("shows placeholder when no action group is configured", () => {
    render(withItemContext("t", <ActionGroupComponent id="t" />));
    expect(screen.getByText("No action group configured")).toBeInTheDocument();
  });

  it("shows group name and OFF state on initial connect", async () => {
    fake = await setupFakeTelemachus({});
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
    fake = await setupFakeTelemachus({});
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
    fake = await setupFakeTelemachus({});
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

    // The click dispatches the toggle at the DataSource (write path unchanged).
    expect(fake.executedActions).toContain("f.ag1");

    // KSP echoes the new state back on the READ channel the widget actually
    // watches. Emitted explicitly here because the echo now arrives on
    // `vessel.control`, not on the legacy `v.ag1Value` key the fake would have
    // flipped for us.
    stream.emitControl(ag(1, true));

    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("shows a disabled toggle for a read-only group (Precision Control)", async () => {
    fake = await setupFakeTelemachus({});
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

  /**
   * BEHAVIOUR DELTA, asserted rather than quietly dropped. This used to assert
   * the pill cleared to "—" when the legacy `DataSource` disconnected. Now that
   * the widget reads the canonical stream, it HOLDS the last-known value
   * instead — the documented M2 semantic delta (`useTelemetry`'s own doc
   * comment: "the legacy path clears to `undefined` when the DataSource status
   * leaves connected; the new streamed path does not — a TelemetryClient holds
   * the last-known value... a defensible, documented gap, not a silent
   * regression"). Staleness is meant to surface via `useStreamStatus`, which
   * this widget does not yet adopt.
   *
   * Pinned here so the day ActionGroup grows a staleness affordance, this test
   * is the thing that has to change on purpose.
   */
  it("holds the last-known state when the legacy connection drops (streamed reads)", async () => {
    fake = await setupFakeTelemachus({});
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

    act(() => {
      fake?.telemachus.disconnect();
    });

    expect(screen.getByText("ON")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("toggles SAS independently from AG1", async () => {
    const user = userEvent.setup();
    fake = await setupFakeTelemachus({});
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

    expect(fake.executedActions).toContain("f.sas");

    stream.emitControl({ sas: true });

    expect(await screen.findByText("ON")).toBeInTheDocument();
  });

  it("hides the alarm bell when no AlarmsLauncherProvider is mounted", async () => {
    fake = await setupFakeTelemachus({ "v.ag1Value": false });
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );
    fake.seed();

    await waitFor(() => expect(screen.getByText("AG1")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /set alarm to fire ag1/i }),
    ).not.toBeInTheDocument();
  });

  it("invokes the alarms launcher with the group's toggle action when the bell is clicked", async () => {
    const user = userEvent.setup();
    const launcher = vi.fn();
    fake = await setupFakeTelemachus({ "v.ag1Value": false });
    render(
      <AlarmsLauncherProvider launcher={launcher}>
        {withItemContext(
          "t",
          <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
        )}
      </AlarmsLauncherProvider>,
    );
    fake.seed();

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
    fake = await setupFakeTelemachus({ "v.precisionControlValue": false });
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
    fake.seed();

    await waitFor(() =>
      expect(screen.getByText("Precision Control")).toBeInTheDocument(),
    );
    // No bell — without a toggle action there's nothing for the alarm to
    // dispatch, so the affordance is suppressed.
    expect(
      screen.queryByRole("button", { name: /set alarm to fire/i }),
    ).not.toBeInTheDocument();
  });
});
