/**
 * GOLDEN end-to-end test: a byte on the serial port triggers the ActionGroup's
 * toggle action, which fires `useCommand` and dispatches straight through the
 * Sitrep `TelemetryClient` to the transport. No internal mocks for the serial
 * half: real WebSerialTransport (via MockWebSerial), real
 * SerialDeviceService, real InputDispatcher, real dispatchAction, real
 * useActionInput, real useCommand.
 *
 * Was `serial-to-telemachus.test.tsx`, driving the legacy
 * `useExecuteAction("data")` write path against a `MockDataSource`-backed
 * `fakeTelemachus` fixture. That fixture and the write path it stood in for
 * are both gone: ActionGroup's toggle now rides `useCommand`
 * (command-surface-delay-audit), so this test dispatches the AGX
 * `setActionGroup` command straight at a `StubTransport` and asserts
 * `transport.sentCommands`, the same read+write stream this widget actually
 * uses in production (see `ActionGroup/index.test.tsx` for the componentwide
 * unit coverage of every group's command mapping; this file exists to prove
 * the serial → dispatch cascade reaches that path end-to-end).
 */

import { ActionGroupComponent } from "@ksp-gonogo/components";
import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
} from "@ksp-gonogo/core";
import {
  type DeviceInstance,
  InputDispatcher,
  MockWebSerial,
  SerialDeviceProvider,
  SerialDeviceService,
} from "@ksp-gonogo/serial";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  clearActionHandlers();
});

describe("serial → action → sitrep command end-to-end", () => {
  it("emits bytes from a virtual serial port → toggles AG1 via useCommand", async () => {
    // ── 1. Mock navigator.serial ─────────────────────────────────────────
    const mock = new MockWebSerial();
    mock.install({ force: true });
    const port = mock.createPort();

    // ── 2. Construct a SerialDeviceService with a real WebSerialTransport ─
    const service = new SerialDeviceService({
      screenKey: "serial-e2e",
      renderDebounceMs: 0,
    });
    // Wipe the seeded defaults so only our test device is present.
    for (const d of service.getDevices()) await service.removeDevice(d.id);
    for (const t of service.getDeviceTypes())
      await service.removeDeviceType(t.id);

    // Device type: two buttons via char-position at offsets 1 and 3.
    service.upsertDeviceType({
      id: "panel",
      name: "Panel",
      parser: "char-position",
      inputs: [
        { id: "btnA", name: "A", kind: "button", offset: 1, length: 1 },
        { id: "btnB", name: "B", kind: "button", offset: 3, length: 1 },
      ],
    });
    const instance: DeviceInstance = {
      id: "panel-1",
      name: "Panel 1",
      typeId: "panel",
      transport: "web-serial",
    };
    service.addDevice(instance);
    await service.connect(instance.id);

    // ── 3. Mount ActionGroup with toggle mapped to the panel's A button ──
    const mappings = {
      toggle: { deviceId: "panel-1", inputId: "btnA" },
    };

    const dispatcher = new InputDispatcher({
      service,
      getItems: () => [
        {
          i: "ag-1",
          componentId: "action-group",
          config: { actionGroupId: "AG1" as const },
          inputMappings: mappings,
        },
      ],
    });

    // Both ActionGroup's READ path (the canonical `vessel.control` stream)
    // and its WRITE path (`useCommand`) ride the same `TelemetryClient` now,
    // so a single `StubTransport` carries the whole cascade under test:
    // serial byte → parser → InputDispatcher → dispatchAction →
    // useActionInput → handleToggle → useCommand.send → client.dispatch →
    // transport.send.
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
    const emitAg1 = (state: boolean) => {
      act(() => {
        transport.emit("vessel.control", {
          sasMode: 0,
          throttle: 0,
          actionGroups: [{ index: 1, name: "AG1", state }],
        });
        store.beginFrame();
      });
    };

    const { unmount } = render(
      <TelemetryProvider
        client={client}
        store={store}
        carriedChannels={new Set(["vessel.control"])}
      >
        <SerialDeviceProvider service={service}>
          <ModalProvider>
            <DashboardItemContext.Provider value={{ instanceId: "ag-1" }}>
              <ActionGroupComponent
                id="ag-1"
                config={{ actionGroupId: "AG1" }}
              />
            </DashboardItemContext.Provider>
          </ModalProvider>
        </SerialDeviceProvider>
      </TelemetryProvider>,
    );

    emitAg1(false);

    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());

    // ── 4. Drive the serial port: press button A ──────────────────────
    // Drive the full cascade (serial read → parser → InputDispatcher →
    // ActionGroup handler → dispatchAction → useCommand.send →
    // client.dispatch → transport.send) inside a single act scope. The raw
    // microtask drains that used to live here ran outside act, so the
    // trailing setState landed outside React's act boundary and tripped a
    // warning.
    await act(async () => {
      await port.emitData(" 1 0 \n");
      // Drain enough microtasks for the full async cascade to settle.
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // ── 5. Assert the transport saw the command + UI reflects the toggle ──
    // AG1 is an AGX/stock custom (`group.index !== undefined`), so its toggle
    // resolves to the shared `setActionGroup` command, keyed by index and
    // inverting the current (false) state.
    await waitFor(() => {
      const sent = transport.sentCommands.find(
        (c) => c.command === "vessel.control.setActionGroup",
      );
      expect(sent).toBeDefined();
      expect(sent?.args).toEqual({ group: 1, state: true });
    });

    // KSP echoes the new state back on the channel the widget reads.
    emitAg1(true);
    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());

    // Unmount so pending subscribers are torn down before disposal.
    unmount();

    dispatcher.dispose();
    await service.destroy();
    mock.restore();
  });
});
