/**
 * A local screen hosts or joins by itself: it waits for the game, claims the
 * host role, and hosts when it is granted or joins the holder's code when it
 * is refused, taking over when the role comes free.
 *
 * Real `LocalScreen`, `HostRole`, `PeerHostService` and `MainScreen`, the
 * game's host record kept by `FakeHostMod` behind a stub transport, over an
 * in-process PeerJS stand-in.
 */

import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../analytics/AnalyticsConsentService";
import { HostRole } from "../hosting/HostRole";
import { peerHostService } from "../peer/PeerHostService";
import { FakeHostMod } from "../test/fakeHostMod";
import { LocalScreen } from "./LocalScreen";

const peerRegistry = vi.hoisted(
  () =>
    new Map<
      string,
      { emit: (event: string, ...args: unknown[]) => void; destroyed: boolean }
    >(),
);

vi.mock("peerjs", () => {
  type Listener = (...args: unknown[]) => void;

  class FakeDataConnection {
    peer: string;
    open = false;
    private listeners = new Map<string, Listener[]>();
    private remote: FakeDataConnection | null = null;

    constructor(remotePeerId: string) {
      this.peer = remotePeerId;
    }

    on(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners
        .get(event)
        ?.slice()
        .forEach((cb) => {
          cb(...args);
        });
    }

    pair(remote: FakeDataConnection) {
      this.remote = remote;
      remote.remote = this;
    }

    markOpen() {
      this.open = true;
      queueMicrotask(() => this.emit("open"));
    }

    send(data: unknown) {
      if (!this.remote) return;
      const copy = structuredClone(data);
      queueMicrotask(() => this.remote?.emit("data", copy));
    }

    close() {
      if (!this.open) return;
      this.open = false;
      this.emit("close");
      this.remote?.emit("close");
    }
  }

  class FakePeer {
    id: string;
    open = false;
    destroyed = false;
    private listeners = new Map<string, Listener[]>();

    constructor(id?: string) {
      this.id =
        typeof id === "string" && id.length > 0
          ? id
          : `STN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      peerRegistry.set(this.id, {
        emit: (event, ...args) => this.emit(event, ...args),
        destroyed: false,
      });
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.open = true;
        this.emit("open", this.id);
      });
    }

    on(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners
        .get(event)
        ?.slice()
        .forEach((cb) => {
          cb(...args);
        });
    }

    connect(otherId: string): FakeDataConnection {
      const localConn = new FakeDataConnection(otherId);
      queueMicrotask(() => {
        const remote = peerRegistry.get(otherId);
        if (!remote || remote.destroyed) {
          localConn.emit("error", new Error(`peer ${otherId} not found`));
          return;
        }
        const remoteConn = new FakeDataConnection(this.id);
        localConn.pair(remoteConn);
        remote.emit("connection", remoteConn);
        queueMicrotask(() => {
          localConn.markOpen();
          remoteConn.markOpen();
        });
      });
      return localConn;
    }

    reconnect() {}

    destroy() {
      this.destroyed = true;
      const ctx = peerRegistry.get(this.id);
      if (ctx) ctx.destroyed = true;
      peerRegistry.delete(this.id);
    }
  }

  return { default: FakePeer };
});

/**
 * The screen's connection to a game whose host record `mod` keeps.
 * `dropSocket` closes it at the game's end, as a page going away does.
 */
function connectionTo(
  mod: FakeHostMod,
): StubTransport & { dropSocket(): void } {
  const stub = new StubTransport();
  const connection = mod.connect();
  stub.setCommandHandler((command, args) =>
    mod.answer(
      connection,
      command,
      typeof args === "object" && args !== null
        ? (args as Record<string, unknown>)
        : {},
    ),
  );
  connection.subscribe("host.record", (record) =>
    stub.emit("host.record", record),
  );
  return Object.assign(stub, { dropSocket: () => connection.close() });
}

const tabToken = async () => ({ token: "tab-local", release: () => {} });

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/**
 * Wait inside act for the peer host to reach `peerId`, since the broker's
 * answer lands on a later microtask and updates the mounted screen.
 */
async function untilPeerId(peerId: string | null): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(peerHostService.peerId).toBe(peerId));
  });
}

function renderLocal(stub: StubTransport, mod?: FakeHostMod) {
  const view = render(
    <ErrorBoundary>
      <ModalProvider>
        <LocalScreen
          seat="main"
          openTransport={() => stub}
          acquireToken={tabToken}
        />
      </ModalProvider>
    </ErrorBoundary>,
  );
  return {
    ...view,
    /** The game publishes its record, as it does once the screen subscribes. */
    publish: () => act(() => stub.emit("host.record", mod?.record())),
  };
}

describe("a local screen", () => {
  beforeEach(() => {
    clearRegistry();
    localStorage.clear();
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "disabled");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    // The host is a shared service, and stopping it updates the screen still mounted on it.
    act(() => peerHostService.stop());
    peerRegistry.clear();
    vi.unstubAllGlobals();
  });

  it("waits for the game until the mod answers, and never asks for a code", async () => {
    const silent = new StubTransport();
    renderLocal(silent);
    await settle();

    expect(screen.getByText("Waiting for the game")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Join code" })).toBeNull();
  });

  it("hosts under the game's join code when nobody holds the role", async () => {
    const mod = new FakeHostMod();
    const { publish } = renderLocal(connectionTo(mod), mod);
    await settle();
    await publish();
    await settle();

    expect(screen.queryByText("Waiting for the game")).toBeNull();
    await untilPeerId(`gonogo-host-${mod.code}`);
    expect(mod.sent.map((s) => s.command)).toContain("host.claim");
  });

  it("never opens the station endpoint while another screen holds the role, and opens it once granted", async () => {
    const sockets: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/bootstrap-config")
        ? Promise.resolve(
            Response.json({ kspHost: null, stationEndpoint: true }),
          )
        : realFetch(input, init),
    );
    vi.stubGlobal(
      "WebSocket",
      class {
        static readonly OPEN = 1;
        readyState = 0;
        binaryType = "";
        constructor(url: string) {
          if (url.endsWith("/stations")) sockets.push(url);
        }
        addEventListener() {}
        send() {}
        close() {}
      },
    );
    const mod = new FakeHostMod();
    const other = new HostRole("tab-other");
    other.attach(mod.connect());
    await settle();
    const { publish } = renderLocal(connectionTo(mod), mod);
    await settle();
    await publish();
    await settle();
    expect(sockets).toEqual([]);

    other.release();
    await settle();
    await untilPeerId(`gonogo-host-${mod.code}`);
    expect(sockets.length).toBeGreaterThan(0);
    other.dispose();
  });

  it("joins the holder's code with nothing typed when another screen holds the role", async () => {
    const mod = new FakeHostMod();
    const other = new HostRole("tab-other");
    other.attach(mod.connect());
    await settle();

    const { publish } = renderLocal(connectionTo(mod), mod);
    await settle();
    await publish();
    await settle();

    expect(screen.queryByText("Waiting for the game")).toBeNull();
    expect(peerHostService.peerId).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Join code" })).toBeNull();
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          screen.queryAllByText(new RegExp(`host.*${mod.code}`)),
        ).not.toHaveLength(0),
      );
    });
    const told = screen.getAllByText(new RegExp(`host.*${mod.code}`));
    expect(told.some((element) => element.closest("[aria-live]"))).toBe(true);
    other.dispose();
  });

  it("takes over when the host gives the role up, and says what it does not have", async () => {
    const mod = new FakeHostMod();
    const other = new HostRole("tab-other");
    other.attach(mod.connect());
    await settle();
    const { publish } = renderLocal(connectionTo(mod), mod);
    await settle();
    await publish();
    await settle();

    other.release();
    await settle();

    await untilPeerId(`gonogo-host-${mod.code}`);
    expect(
      screen.getByText(
        "This screen is now the host. It does not have the previous host's notes, the thread, alarms that are not on the game's clock and GO/NO-GO votes.",
      ),
    ).toBeVisible();
  });

  it("stops hosting at once and joins when another screen holds the role now", async () => {
    const mod = new FakeHostMod();
    const { publish } = renderLocal(connectionTo(mod), mod);
    await settle();
    await publish();
    await settle();
    await untilPeerId(`gonogo-host-${mod.code}`);

    act(() => mod.seize("tab-elsewhere"));
    await settle();

    await untilPeerId(null);
    expect(screen.queryByText("Waiting for the game")).toBeNull();
    expect(peerRegistry.has(`gonogo-host-${mod.code}`)).toBe(false);
  });

  it("keeps the role across a reload while another screen is open, and the other screen never hosts", async () => {
    const mod = new FakeHostMod();
    const first = connectionTo(mod);
    const page = renderLocal(first, mod);
    await settle();
    await page.publish();
    await settle();
    await untilPeerId(`gonogo-host-${mod.code}`);
    const other = new HostRole("tab-other");
    const otherKinds: string[] = [];
    other.subscribe(() => otherKinds.push(other.state.kind));
    other.attach(mod.connect());
    await settle();

    act(() => {
      globalThis.dispatchEvent(new Event("pagehide"));
    });
    // A real socket sends whatever the page wrote before it closes.
    await settle();
    page.unmount();
    first.dropSocket();
    await settle();
    expect(mod.record()).toMatchObject({ held: true, holderAway: true });

    const second = connectionTo(mod);
    const reloaded = renderLocal(second, mod);
    await settle();
    await reloaded.publish();
    await settle();

    await untilPeerId(`gonogo-host-${mod.code}`);
    expect(mod.sent.map((s) => s.command)).not.toContain("host.release");
    expect(otherKinds).not.toContain("hosting");
    expect(other.state.kind).toBe("joined");
    expect(screen.queryByText(/This screen is now the host/)).toBeNull();
    other.dispose();
  });
});
