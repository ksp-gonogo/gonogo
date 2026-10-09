import type { util as peerUtil } from "peerjs";

type Listener = (...args: unknown[]) => void;

/**
 * A fault planted in every channel, so the gate can prove it sees one.
 * `refuse` throws from `send` the way the PeerJS packer does on a number it
 * cannot write; `drop` packs the message and then loses it, as a relay that
 * never forwards a topic would.
 */
export interface ChannelPlant {
  refuse?: (message: unknown) => boolean;
  drop?: (message: unknown) => boolean;
}

export const channelPlant: ChannelPlant = {};

export function clearChannelPlant(): void {
  channelPlant.refuse = undefined;
  channelPlant.drop = undefined;
}

const registry = new Map<string, FakePeerLike>();

interface FakePeerLike {
  emit: (event: string, ...args: unknown[]) => void;
  destroyed: boolean;
}

/** Forgets every peer, so one scene's broker state never reaches the next. */
export function resetFakePeers(): void {
  registry.clear();
}

/**
 * An in-process PeerJS whose data connections carry every message through the
 * real binary codec, `util.pack` on send and `util.unpack` on arrival, as a
 * `serialization: "binary"` DataConnection does. A message the packer refuses
 * throws out of `send` exactly as it does in a browser, and one it accepts
 * arrives as the far side would decode it, not as a structured clone of the
 * sender's object.
 */
export function makeFakePeerjs(util: typeof peerUtil) {
  class FakeDataConnection {
    peer: string;
    open = false;
    peerConnection = undefined;
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
      for (const cb of this.listeners.get(event)?.slice() ?? []) cb(...args);
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
      const remote = this.remote;
      if (!remote) return;
      if (channelPlant.refuse?.(data)) throw new Error("Invalid integer");
      const packed = util.pack(data as Parameters<typeof util.pack>[0]);
      if (channelPlant.drop?.(data)) return;
      const deliver = (buffer: ArrayBuffer) => {
        queueMicrotask(() => remote.emit("data", util.unpack(buffer)));
      };
      if (packed instanceof Promise) {
        void packed.then((buffer) =>
          deliver(new Uint8Array(buffer).slice().buffer),
        );
      } else deliver(packed);
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
      registry.set(this.id, {
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
      for (const cb of this.listeners.get(event)?.slice() ?? []) cb(...args);
    }

    connect(otherId: string): FakeDataConnection {
      const localConn = new FakeDataConnection(otherId);
      queueMicrotask(() => {
        const remote = registry.get(otherId);
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
      const entry = registry.get(this.id);
      if (entry) entry.destroyed = true;
      registry.delete(this.id);
    }
  }

  return FakePeer;
}
