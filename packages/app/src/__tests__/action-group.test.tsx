import { ActionGroupComponent } from "@gonogo/components";
import {
  clearRegistry,
  DashboardItemContext,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { telemachusSource } from "../dataSources/telemachus";

function withItemContext(instanceId: string, children: ReactNode) {
  return (
    <DashboardItemContext.Provider value={{ instanceId }}>
      {children}
    </DashboardItemContext.Provider>
  );
}

const telemachusWs = ws.link("ws://localhost:8085/datalink");
const server = setupServer();

let buffered: BufferedDataSource | null = null;

beforeAll(() => server.listen());
afterEach(() => {
  cleanup(); // unmount before disconnect to avoid out-of-act state updates
  server.resetHandlers();
  telemachusSource.disconnect();
  buffered?.disconnect();
  buffered = null;
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

/**
 * Sets up MSW to handle a Telemachus WS connection and HTTP execute requests.
 *
 * The WS handler responds to {"run": [...keys]} subscription messages by
 * streaming back current state. The HTTP handler handles action toggles and
 * pushes the updated state back through the WS connection.
 */
function setupTelemachus(initialState: Record<string, unknown> = {}) {
  // Assume a healthy CommNet link by default — without it, BufferedDataSource
  // would gate every non-comm.* sample and every test here would look broken.
  // Individual tests that want to exercise blackout can override.
  const state: Record<string, unknown> = {
    "comm.connected": true,
    ...initialState,
  };
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
        // Derive the value key: f.ag1 → v.ag1Value, f.sas → v.sasValue
        const base = actionKey.replace(/^f\./, "");
        const valueKey = `v.${base}Value`;
        state[valueKey] = !(state[valueKey] as boolean);
        pushState(); // immediately push updated state over WS
        return HttpResponse.json({ a: null });
      }
      return new HttpResponse(null, { status: 404 });
    }),
  );

  return state;
}

describe("ActionGroup component", () => {
  it("shows placeholder when no action group is configured", () => {
    render(withItemContext("t", <ActionGroupComponent id="t" />));
    expect(screen.getByText("No action group configured")).toBeInTheDocument();
  });

  it("shows group name and OFF state on initial connect", async () => {
    setupTelemachus({ "v.ag1Value": false });
    await telemachusSource.connect();
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );

    await waitFor(() => expect(screen.getByText("AG1")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());
  });

  it("shows ON when the action group is already active", async () => {
    setupTelemachus({ "v.ag1Value": true });
    await telemachusSource.connect();
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());
  });

  it("sends a toggle request and reflects the updated state", async () => {
    const user = userEvent.setup();
    setupTelemachus({ "v.ag1Value": false });
    await telemachusSource.connect();
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );

    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /toggle ag1/i }));

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());
  });

  it("shows no toggle button for a read-only group (Precision Control)", async () => {
    setupTelemachus({ "v.precisionControlValue": false });
    await telemachusSource.connect();
    render(
      withItemContext(
        "t",
        <ActionGroupComponent
          config={{ actionGroupId: "Precision Control" }}
          id="t"
        />,
      ),
    );

    await waitFor(() =>
      expect(screen.getByText("Precision Control")).toBeInTheDocument(),
    );
    // The rename handle has role="button" too; assert only the toggle is absent.
    expect(
      screen.queryByRole("button", { name: /toggle/i }),
    ).not.toBeInTheDocument();
  });

  it("clears state to unknown when the connection drops", async () => {
    let serverClient: { close: (code?: number) => void } | null = null;
    server.use(
      telemachusWs.addEventListener("connection", ({ client }) => {
        serverClient = client;
        client.addEventListener("message", ({ data }) => {
          const msg = JSON.parse(data as string) as { "+"?: string[] };
          if (msg["+"]) client.send(JSON.stringify({ "v.ag1Value": true }));
        });
      }),
    );

    await telemachusSource.connect();
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "AG1" }} id="t" />,
      ),
    );

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());

    act(() => {
      serverClient?.close();
    });

    await waitFor(() => expect(screen.getByText("—")).toBeInTheDocument());
  });

  it("toggles SAS independently from AG1", async () => {
    const user = userEvent.setup();
    setupTelemachus({ "v.sasValue": false });
    await telemachusSource.connect();
    render(
      withItemContext(
        "t",
        <ActionGroupComponent config={{ actionGroupId: "SAS" }} id="t" />,
      ),
    );

    await waitFor(() => expect(screen.getByText("OFF")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /toggle sas/i }));

    await waitFor(() => expect(screen.getByText("ON")).toBeInTheDocument());
  });
});
