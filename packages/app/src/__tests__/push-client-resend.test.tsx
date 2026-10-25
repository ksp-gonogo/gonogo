import { act, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

const { FakePeer } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    sent: Array<{ type?: string }> = [];

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
    }

    close() {
      this.emit("close");
    }

    send(msg: { type?: string }) {
      this.sent.push(msg);
    }
  }

  class FakePeer {
    static instances: FakePeer[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    lastConn: FakeDataConnection | null = null;

    constructor() {
      FakePeer.instances.push(this);
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
    }

    connect() {
      this.lastConn = new FakeDataConnection();
      return this.lastConn;
    }

    destroy() {}
  }

  return { FakePeer };
});

vi.mock("peerjs", () => ({ default: FakePeer }));

import { PeerClientProvider } from "../peer/PeerClientContext";
import { PeerClientService } from "../peer/PeerClientService";
import {
  PushClientProvider,
  usePushClient,
} from "../pushToMain/PushClientContext";

/** Open the newest Peer's link to the host and deliver the host's hello on it. */
function openLink(sessionToken: string) {
  const peer = FakePeer.instances[FakePeer.instances.length - 1];
  peer.emit("open");
  const conn = peer.lastConn;
  if (!conn) throw new Error("expected a connection to the host");
  conn.emit("open");
  conn.emit("data", {
    type: "hello",
    version: "1.0.0",
    buildTime: "t",
    sessionToken,
  });
  return conn;
}

const INTENT = {
  widgetInstanceId: "w1",
  componentId: "altitude",
  config: {},
  width: 4,
  height: 4,
};

describe("PushClientProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    FakePeer.instances = [];
  });

  it("pushes its widgets again when the link to the main screen comes back", () => {
    vi.useFakeTimers();
    const client = new PeerClientService();
    client.connect("HOST");
    const first = openLink("session-A");

    const held: { api: ReturnType<typeof usePushClient> } = { api: null };
    function Probe() {
      held.api = usePushClient();
      return null;
    }
    render(
      <PeerClientProvider client={client}>
        <PushClientProvider>
          <Probe />
        </PushClientProvider>
      </PeerClientProvider>,
    );

    act(() => {
      held.api?.push(INTENT);
    });
    expect(first.sent.filter((m) => m.type === "widget-push")).toHaveLength(1);

    first.emit("close");
    vi.advanceTimersByTime(60_000);
    let second: ReturnType<typeof openLink> | undefined;
    act(() => {
      second = openLink("session-B");
    });
    expect(second?.sent.filter((m) => m.type === "widget-push")).toEqual([
      { type: "widget-push", ...INTENT },
    ]);
    expect(held.api?.isPushed("w1")).toBe(true);
    client.disconnect();
  });

  it("does not push a recalled widget again", () => {
    vi.useFakeTimers();
    const client = new PeerClientService();
    client.connect("HOST");
    const first = openLink("session-A");

    const held: { api: ReturnType<typeof usePushClient> } = { api: null };
    function Probe() {
      held.api = usePushClient();
      return null;
    }
    render(
      <PeerClientProvider client={client}>
        <PushClientProvider>
          <Probe />
        </PushClientProvider>
      </PeerClientProvider>,
    );
    act(() => {
      held.api?.push(INTENT);
    });
    act(() => {
      held.api?.recall("w1");
    });
    first.emit("close");
    vi.advanceTimersByTime(60_000);
    let second: ReturnType<typeof openLink> | undefined;
    act(() => {
      second = openLink("session-A");
    });
    expect(second?.sent.filter((m) => m.type === "widget-push")).toEqual([]);
    client.disconnect();
  });
});
