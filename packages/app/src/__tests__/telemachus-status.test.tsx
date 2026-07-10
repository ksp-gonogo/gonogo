import { DataSourceStatusComponent } from "@ksp-gonogo/components";
import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  TelemachusDataSource,
  telemachusSource,
} from "../dataSources/telemachus";

const telemachusWs = ws.link("ws://localhost:8085/datalink");
const telemachusWs9000 = ws.link("ws://localhost:9000/datalink");
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => {
  cleanup(); // unmount before disconnect to avoid out-of-act state updates
  server.resetHandlers();
  telemachusSource.disconnect();
});
afterAll(() => server.close());

beforeEach(() => {
  clearRegistry();
  registerDataSource(telemachusSource);
});

describe("Telemachus Reborn data source status", () => {
  it("shows disconnected before connect() is called", () => {
    render(<DataSourceStatusComponent />);

    expect(screen.getByText("Telemachus Reborn")).toBeInTheDocument();
    expect(screen.getByText("disconnected")).toBeInTheDocument();
  });

  it("shows connected when the WebSocket handshake succeeds", async () => {
    server.use(telemachusWs.addEventListener("connection", () => {}));

    // Connect before rendering so the component mounts with status already 'connected',
    // avoiding an out-of-act state transition when the WebSocket 'open' event fires.
    await telemachusSource.connect();
    render(<DataSourceStatusComponent />);

    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("returns to disconnected after an explicit disconnect", async () => {
    server.use(telemachusWs.addEventListener("connection", () => {}));

    render(<DataSourceStatusComponent />);
    await act(async () => {
      await telemachusSource.connect();
    });
    await waitFor(() =>
      expect(screen.getByText("connected")).toBeInTheDocument(),
    );

    act(() => {
      telemachusSource.disconnect();
    });
    await waitFor(() =>
      expect(screen.getByText("disconnected")).toBeInTheDocument(),
    );
  });

  it("begins reconnecting when the server closes the connection", async () => {
    // setStatus('reconnecting') fires synchronously in onClose(), so waitFor catches it
    // quickly. The 5 s retry timer is cleaned up by afterEach disconnect.
    let serverClient: { close: (code?: number) => void } | null = null;
    server.use(
      telemachusWs.addEventListener("connection", ({ client }) => {
        serverClient = client;
      }),
    );

    render(<DataSourceStatusComponent />);
    await act(async () => {
      await telemachusSource.connect();
    });
    await waitFor(() =>
      expect(screen.getByText("connected")).toBeInTheDocument(),
    );

    act(() => {
      serverClient?.close();
    });
    await waitFor(() =>
      expect(screen.getByText("reconnecting")).toBeInTheDocument(),
    );
  });

  // -------------------------------------------------------------------------
  // Reconnect loop — use a source with short retry params so tests run fast.
  // -------------------------------------------------------------------------
  describe("reconnect loop", () => {
    let source: TelemachusDataSource;

    beforeEach(() => {
      clearRegistry();
      source = new TelemachusDataSource(
        { host: "localhost", port: 8085 },
        { retryIntervalMs: 50, retryTimeoutMs: 300 },
      );
      registerDataSource(source);
    });

    afterEach(() => {
      cleanup(); // unmount before disconnect — mirrors outer afterEach pattern
      source.disconnect();
    });

    it("reconnects automatically when the server comes back", async () => {
      let serverClient: { close: () => void } | null = null;
      server.use(
        telemachusWs.addEventListener("connection", ({ client }) => {
          serverClient = client;
          // All connections stay open; test closes the first one explicitly inside act()
        }),
      );

      render(<DataSourceStatusComponent />);
      await act(async () => {
        await source.connect();
      });
      expect(screen.getByText("connected")).toBeInTheDocument();

      // Close inside act() so the resulting 'reconnecting' state update is captured.
      // Then await a Promise inside act() for 'connected' so the async retry's 'open'
      // event (which fires after ~50ms) is also captured within the act() scope.
      await act(async () => {
        const connected = new Promise<void>((resolve) => {
          const unsub = source.onStatusChange((s) => {
            if (s === "connected") {
              unsub();
              resolve();
            }
          });
        });
        serverClient?.close();
        await connected;
      });

      expect(screen.getByText("connected")).toBeInTheDocument();
    });

    it("shows disconnected with a retry button after giving up", async () => {
      // setTimeout(() => client.close(), 0) is required because MSW fires 'connection'
      // before the client's 'open' event, so we must defer the close to let connect()
      // resolve. We await a Promise inside act() that resolves only when the source
      // reaches 'disconnected' — keeping us inside the act() scope for all intermediate
      // state updates (connected → reconnecting → ... → disconnected), so no warnings.
      server.use(
        telemachusWs.addEventListener("connection", ({ client }) => {
          setTimeout(() => client.close(), 0);
        }),
      );

      render(<DataSourceStatusComponent />);
      await act(async () => {
        const disconnected = new Promise<void>((resolve) => {
          const unsub = source.onStatusChange((s) => {
            if (s === "disconnected") {
              unsub();
              resolve();
            }
          });
        });
        source.connect();
        await disconnected;
      });

      expect(screen.getByText("disconnected")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /reconnect telemachus reborn/i }),
      ).toBeInTheDocument();
    });

    it("reconnect button triggers a fresh connection attempt", async () => {
      server.use(
        telemachusWs.addEventListener("connection", ({ client }) => {
          setTimeout(() => client.close(), 0); // see note in preceding test
        }),
      );

      render(<DataSourceStatusComponent />);
      await act(async () => {
        const disconnected = new Promise<void>((resolve) => {
          const unsub = source.onStatusChange((s) => {
            if (s === "disconnected") {
              unsub();
              resolve();
            }
          });
        });
        source.connect();
        await disconnected;
      });

      // Now let the next connection succeed
      server.resetHandlers();
      server.use(telemachusWs.addEventListener("connection", () => {}));

      // Click triggers connect() whose 'open' callback fires asynchronously.
      // Await a Promise inside act() that resolves when 'connected' fires, keeping
      // all state updates within the act() scope — no act() warning.
      await act(async () => {
        const connected = new Promise<void>((resolve) => {
          const unsub = source.onStatusChange((s) => {
            if (s === "connected") {
              unsub();
              resolve();
            }
          });
        });
        fireEvent.click(
          screen.getByRole("button", { name: /reconnect telemachus reborn/i }),
        );
        await connected;
      });

      expect(screen.getByText("connected")).toBeInTheDocument();
    });
  });

  describe("config form integration", () => {
    let source: TelemachusDataSource;

    beforeEach(() => {
      clearRegistry();
      source = new TelemachusDataSource({ host: "localhost", port: 8085 });
      registerDataSource(source);
    });

    afterEach(() => {
      cleanup();
      source.disconnect();
    });

    it("reconnects to the new host/port after saving config", async () => {
      server.use(telemachusWs.addEventListener("connection", () => {}));

      render(<DataSourceStatusComponent />);
      await act(async () => {
        await source.connect();
      });
      expect(screen.getByText("connected")).toBeInTheDocument();

      // Open config form — form should pre-fill with current host/port
      fireEvent.click(
        screen.getByRole("button", { name: /configure telemachus reborn/i }),
      );
      expect(screen.getByLabelText("Host")).toHaveValue("localhost");
      expect(screen.getByLabelText("Port")).toHaveValue(8085);

      // Change port and save — source should disconnect then reconnect to new port
      server.use(telemachusWs9000.addEventListener("connection", () => {}));
      await act(async () => {
        const connected = new Promise<void>((resolve) => {
          const unsub = source.onStatusChange((s) => {
            if (s === "connected") {
              unsub();
              resolve();
            }
          });
        });
        fireEvent.change(screen.getByLabelText("Port"), {
          target: { value: "9000" },
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));
        await connected;
      });

      expect(screen.getByText("connected")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /save/i }),
      ).not.toBeInTheDocument();
    });
  });
});
