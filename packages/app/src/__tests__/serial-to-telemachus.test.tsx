/**
 * GOLDEN end-to-end test: a byte on the serial port triggers the ActionGroup's
 * toggle action, which fires a fetch intercepted by MSW and then reflects
 * back over the WS. No internal mocks — real WebSerialTransport (via
 * MockWebSerial), real SerialDeviceService, real InputDispatcher, real
 * dispatchAction, real useActionInput, real useExecuteAction.
 */

import { ActionGroupComponent } from "@ksp-gonogo/components";
import {
  clearActionHandlers,
  clearRegistry,
  DashboardItemContext,
  registerDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import {
  type DeviceInstance,
  InputDispatcher,
  MockWebSerial,
  SerialDeviceProvider,
  SerialDeviceService,
} from "@ksp-gonogo/serial";
import { ModalProvider } from "@ksp-gonogo/ui";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { telemachusSource } from "../dataSources/telemachus";

const telemachusWs = ws.link("ws://localhost:8085/datalink");
const server = setupServer();

let buffered: BufferedDataSource | null = null;

beforeAll(() => server.listen());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  telemachusSource.disconnect();
  buffered?.disconnect();
  buffered = null;
  clearActionHandlers();
});
afterAll(() => server.close());

beforeEach(async () => {
  clearRegistry();
  registerDataSource(telemachusSource);
  buffered = new BufferedDataSource({
    source: telemachusSource,
    store: new MemoryStore(),
  });
  registerDataSource(buffered);
  await buffered.connect();
});

// Identical to the handler in action-group.test.tsx but duplicated so this
// test is self-contained. Pushes state updates over WS on every execute.
function setupTelemachus(initialState: Record<string, unknown> = {}): {
  state: Record<string, unknown>;
  executeSpy: ReturnType<typeof vi.fn>;
} {
  // Default to a healthy CommNet link so BufferedDataSource's signal gate
  // doesn't drop our sample data.
  const state: Record<string, unknown> = {
    "comm.connected": true,
    ...initialState,
  };
  const executeSpy = vi.fn<(actionKey: string) => void>();
  let wsClient: { send: (data: string) => void } | null = null;
  let subscribedKeys: string[] = [];

  const pushState = () => {
    if (!wsClient || subscribedKeys.length === 0) return;
    const update: Record<string, unknown> = {};
    for (const key of subscribedKeys) update[key] = state[key] ?? false;
    wsClient.send(JSON.stringify(update));
  };

  server.use(
    telemachusWs.addEventListener("connection", ({ client }) => {
      wsClient = client;
      client.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data as string) as {
          "+"?: string[];
          "-"?: string[];
        };
        if (msg["+"]) {
          for (const key of msg["+"]) {
            if (!subscribedKeys.includes(key)) subscribedKeys.push(key);
          }
          pushState();
        }
        if (msg["-"]) {
          subscribedKeys = subscribedKeys.filter((k) => !msg["-"]?.includes(k));
        }
      });
    }),
    http.get("http://localhost:8085/telemachus/datalink", ({ request }) => {
      const actionKey = new URL(request.url).searchParams.get("a");
      if (actionKey !== null) {
        executeSpy(actionKey);
        const base = actionKey.replace(/^f\./, "");
        state[`v.${base}Value`] = !(state[`v.${base}Value`] as boolean);
        pushState();
        return HttpResponse.json({ a: null });
      }
      return new HttpResponse(null, { status: 404 });
    }),
  );

  return { state, executeSpy };
}

describe("serial → action → telemachus end-to-end", () => {
  it("emits bytes from a virtual serial port → toggles AG1 via MSW-intercepted fetch", async () => {
    // ── 1. Wire up MSW + mock navigator.serial ──────────────────────────
    const { executeSpy } = setupTelemachus({ "v.ag1Value": false });
    await telemachusSource.connect();

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

    const { unmount } = render(
      <SerialDeviceProvider service={service}>
        <ModalProvider>
          <DashboardItemContext.Provider value={{ instanceId: "ag-1" }}>
            <ActionGroupComponent id="ag-1" config={{ actionGroupId: "AG1" }} />
          </DashboardItemContext.Provider>
        </ModalProvider>
      </SerialDeviceProvider>,
    );

    // Wait for telemachus to push initial state so ActionGroup is "OFF".
    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());

    // ── 4. Drive the serial port: press button A ──────────────────────
    // Drive the full cascade (serial read → parser → InputDispatcher →
    // ActionGroup handler → fetch → MSW → WS push → subscriber → setState)
    // inside a single act scope. The raw microtask drains that used to live
    // here ran outside act, so the trailing setState from the WS push landed
    // outside React's act boundary and tripped a warning.
    await act(async () => {
      await port.emitData(" 1 0 \n");
      // Drain enough microtasks for the full async cascade to settle.
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // ── 5. Assert MSW saw the execute + UI reflects the toggle ────────
    await waitFor(() => expect(executeSpy).toHaveBeenCalledWith("f.ag1"));
    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());

    // Unmount so pending subscribers are torn down before we disconnect the
    // data source in afterEach.
    unmount();

    dispatcher.dispose();
    await service.destroy();
    mock.restore();
  });
});
