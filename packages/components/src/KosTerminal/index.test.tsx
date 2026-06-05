import {
  clearRegistry,
  type DataSource,
  registerDataSource,
} from "@gonogo/core";
import { cleanup, render, waitFor } from "@testing-library/react";
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
  vi,
} from "vitest";
import { axe } from "../test/axe";
import { KosTerminalComponent } from "./index";

// xterm.js requires a canvas-capable DOM which jsdom doesn't provide.
// We mock the external library at the boundary: the real WS and component
// logic remain untouched — only the terminal renderer is stubbed.

// vi.hoisted() runs before vi.mock() hoisting so these refs are available
// inside the mock factories.
const termSpies = vi.hoisted(() => ({
  loadAddon: vi.fn(),
  open: vi.fn(),
  write: vi.fn(),
  writeln: vi.fn(),
  onData: vi.fn(),
  onResize: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  rows: 40,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function (this: object) {
    Object.assign(this, termSpies);
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function (this: {
    fit: ReturnType<typeof vi.fn>;
    proposeDimensions: ReturnType<typeof vi.fn>;
  }) {
    this.fit = vi.fn();
    this.proposeDimensions = vi.fn(() => ({ cols: 120, rows: 40 }));
  }),
}));

// CSS import — no-op in test
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// ResizeObserver is not implemented in jsdom. The KosTerminal waits for a
// sized container before connecting, so simulate a layout-complete entry on
// observe() — otherwise the component would sit in its waiting state until
// the 500 ms fallback fires.
class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [
        {
          target,
          contentRect: { width: 800, height: 400 } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const kosProxyWs = ws.link("ws://localhost:3001/kos");
const server = setupServer();

beforeAll(() => server.listen());
beforeEach(() => {
  vi.clearAllMocks();
  // KosTerminal now reads kosHost/kosPort live from the registered `kos`
  // data source (no per-instance config). Register a stub so the widget
  // sees the same endpoint values the assertions expect.
  registerDataSource({
    id: "kos",
    name: "kOS",
    status: "connected",
    affectedBySignalLoss: false,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    onStatusChange: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({
      host: "localhost",
      port: 3001,
      kosHost: "192.168.1.1",
      kosPort: 5410,
    }),
  } as unknown as DataSource);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  clearRegistry();
});
afterAll(() => server.close());

const DEFAULT_CONFIG = {};

const MENU_WITH_CPUS = [
  "Terminal: type = XTERM-256COLOR, size = 123x18",
  "__________________________________________________________________________",
  "                        Pick Open Telnets  Vessel Name (CPU tagname)",
  "                        ---- ---- -------  --------------------------------",
  "                         [1]   no    0     Untitled Space Craft (KAL9000(system))",
  "                         [2]   no    0     Untitled Space Craft (KAL9000(console))",
  "--------------------------------------------------------------------------",
  "Choose a CPU to attach to by typing a selection number and pressing return/enter.",
  "--------------------------------------------------------------------------",
].join("\n");

describe("KosTerminal", () => {
  it("connects to the proxy WebSocket with the correct URL on mount", async () => {
    const connected = new Promise<string>((resolve) => {
      server.use(
        kosProxyWs.addEventListener("connection", ({ client }) => {
          resolve(String(client.url));
        }),
      );
    });

    render(<KosTerminalComponent config={DEFAULT_CONFIG} />);

    const url = await connected;
    expect(url).toContain("host=192.168.1.1");
    expect(url).toContain("port=5410");
  });

  it("writes incoming proxy messages to the terminal", async () => {
    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.send("Hello from kOS!\r\n");
      }),
    );

    render(<KosTerminalComponent config={DEFAULT_CONFIG} />);

    await waitFor(() => {
      expect(termSpies.write).toHaveBeenCalledWith("Hello from kOS!\r\n");
    });
  });

  it("sends user input through the WebSocket", async () => {
    const received: string[] = [];

    const clientReady = new Promise<void>((resolve) => {
      server.use(
        kosProxyWs.addEventListener("connection", ({ client }) => {
          client.addEventListener("message", ({ data }) =>
            received.push(data as string),
          );
          resolve();
        }),
      );
    });

    render(<KosTerminalComponent config={DEFAULT_CONFIG} />);
    await clientReady;

    // Retrieve the onData callback registered by the component and simulate typing
    await waitFor(() => expect(termSpies.onData).toHaveBeenCalled());
    const onDataHandler = vi.mocked(termSpies.onData).mock.calls[0][0] as (
      data: string,
    ) => void;
    onDataHandler('PRINT "hello".\n');

    await waitFor(() => expect(received).toContain('PRINT "hello".\n'));
  });

  it("does not register an onData handler when readOnly is true", async () => {
    const clientReady = new Promise<void>((resolve) => {
      server.use(kosProxyWs.addEventListener("connection", () => resolve()));
    });

    render(
      <KosTerminalComponent config={{ ...DEFAULT_CONFIG, readOnly: true }} />,
    );
    await clientReady;
    await new Promise((r) => setTimeout(r, 20));

    expect(termSpies.onData).not.toHaveBeenCalled();
  });

  it("does not forward keystrokes when readOnly is true", async () => {
    const received: string[] = [];

    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.addEventListener("message", ({ data }) =>
          received.push(data as string),
        );
      }),
    );

    render(
      <KosTerminalComponent config={{ ...DEFAULT_CONFIG, readOnly: true }} />,
    );
    await new Promise((r) => setTimeout(r, 20));

    // No onData handler — simulating typing has no effect
    expect(termSpies.onData).not.toHaveBeenCalled();
    expect(received).toHaveLength(0);
  });

  it("auto-selects the named CPU when the menu arrives", async () => {
    const received: string[] = [];

    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.addEventListener("message", ({ data }) =>
          received.push(data as string),
        );
        client.send(MENU_WITH_CPUS);
      }),
    );

    render(
      <KosTerminalComponent
        config={{ ...DEFAULT_CONFIG, cpuName: "console" }}
      />,
    );

    await waitFor(() => expect(received).toContain("2\n"));
  });

  it("still renders the menu in the terminal when auto-selecting", async () => {
    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.send(MENU_WITH_CPUS);
      }),
    );

    render(
      <KosTerminalComponent
        config={{ ...DEFAULT_CONFIG, cpuName: "console" }}
      />,
    );

    await waitFor(() => {
      expect(termSpies.write).toHaveBeenCalledWith(
        expect.stringContaining("KAL9000"),
      );
    });
  });

  it("does not auto-select when the named CPU is not in the menu", async () => {
    const received: string[] = [];

    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.addEventListener("message", ({ data }) =>
          received.push(data as string),
        );
        client.send(MENU_WITH_CPUS);
      }),
    );

    render(
      <KosTerminalComponent
        config={{ ...DEFAULT_CONFIG, cpuName: "navigation" }}
      />,
    );
    await new Promise((r) => setTimeout(r, 40));

    // Should not have sent any selection — wrong CPU name
    expect(received.filter((m) => /^\d+\n$/.test(m))).toHaveLength(0);
  });

  it("auto-selects after a list-changed event resets the menu buffer", async () => {
    const received: string[] = [];

    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.addEventListener("message", ({ data }) =>
          received.push(data as string),
        );
        // First: send a partial/empty menu, then a list-changed + full menu
        client.send("some partial output without the header");
        setTimeout(() => {
          client.send(`--(List of CPU's has Changed)--\n${MENU_WITH_CPUS}`);
        }, 10);
      }),
    );

    render(
      <KosTerminalComponent
        config={{ ...DEFAULT_CONFIG, cpuName: "system" }}
      />,
    );

    await waitFor(() => expect(received).toContain("1\n"));
  });

  it("surfaces a session-ended notice when kOS prints a connection-closed sentinel", async () => {
    const events: string[] = [];
    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.addEventListener("close", () => events.push("closed"));
        // kOS-side telnet dropping the session while the WS stays open.
        client.send("\r\nConnection closed by foreign host.\r\n");
      }),
    );

    render(<KosTerminalComponent config={DEFAULT_CONFIG} />);

    await waitFor(() => {
      expect(termSpies.writeln).toHaveBeenCalledWith(
        expect.stringContaining("[session ended]"),
      );
    });
    // The sentinel-driven close should have triggered an explicit ws.close(),
    // which the MSW server observes.
    await waitFor(() => expect(events).toContain("closed"));
  });

  it("does not fire the session-ended notice twice for follow-up chunks", async () => {
    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.send("\r\nConnection closed by foreign host.\r\n");
        client.send("Connection closed by foreign host.\r\n"); // repeat
      }),
    );

    render(<KosTerminalComponent config={DEFAULT_CONFIG} />);

    await waitFor(() => {
      expect(termSpies.writeln).toHaveBeenCalledWith(
        expect.stringContaining("[session ended]"),
      );
    });
    const endedCalls = vi
      .mocked(termSpies.writeln)
      .mock.calls.filter((c) => String(c[0]).includes("[session ended]"));
    expect(endedCalls.length).toBe(1);
  });

  it("closes the WebSocket when the component unmounts", async () => {
    const events: string[] = [];
    server.use(
      kosProxyWs.addEventListener("connection", ({ client }) => {
        client.addEventListener("close", () => events.push("closed"));
      }),
    );

    const { unmount } = render(
      <KosTerminalComponent config={DEFAULT_CONFIG} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    unmount();

    await waitFor(() => expect(events).toContain("closed"));
  });

  it("has no accessible violations", async () => {
    const connected = new Promise<void>((resolve) => {
      server.use(kosProxyWs.addEventListener("connection", () => resolve()));
    });

    const { container } = render(
      <KosTerminalComponent config={DEFAULT_CONFIG} />,
    );
    await connected;

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
