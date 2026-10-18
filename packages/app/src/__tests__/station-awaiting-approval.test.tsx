/**
 * A station the main screen has not approved is sent nothing, so it shows
 * that it is waiting, and its dashboard appears once the main screen
 * approves it.
 *
 * Real `PeerHostService`, `PeerClientService` and `StationScreen` over an
 * in-process PeerJS stand-in.
 */

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

import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../analytics/AnalyticsConsentService";
import { PeerHostService } from "../peer/PeerHostService";
import { StationScreen } from "../screens/StationScreen";

const WAITING = "Waiting for the main screen to approve this station";

describe("a station waiting for the main screen's approval", () => {
  let host: PeerHostService;

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
    act(() => host.stop());
    peerRegistry.clear();
    vi.unstubAllGlobals();
  });

  it("shows only that it is waiting, then its dashboard once approved", async () => {
    host = new PeerHostService();
    await host.start();
    await waitFor(() => expect(host.peerId).not.toBeNull());
    globalThis.history.replaceState({}, "", `/station?host=${host.shareCode}`);

    render(
      <ErrorBoundary>
        <ModalProvider>
          <StationScreen />
        </ModalProvider>
      </ErrorBoundary>,
    );

    await waitFor(() => expect(screen.getByText(WAITING)).toBeVisible());
    expect(host.pendingStations()).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Host ID" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add component" })).toBeNull();

    const [pending] = host.pendingStations();
    act(() => host.approveStation(pending.peerId));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add component" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(WAITING)).toBeNull();
    await act(async () => {});
  });
});
