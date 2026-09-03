import type { PeerClientService } from "../peer/PeerClientService";
import type { PeerHostService } from "../peer/PeerHostService";
import type { CommsAck, CommsMessage } from "./types";

export interface CommcastMeshHandlers {
  /** A message arrived on the wire. The log decides whether it is for here. */
  onMessage(msg: CommsMessage): void;
  /** An acknowledgement arrived. The log decides whether it is about here. */
  onAck(ack: CommsAck): void;
}

/**
 * The wire under Commcast: a RELAY, not a store.
 *
 * PeerJS is a star, so two stations cannot speak to each other and every frame
 * passes through the host. That makes the host a router and nothing more: it
 * repeats what it receives to the other peers and keeps a copy only when the
 * frame is addressed to its OWN vantage, on exactly the same rule every other
 * participant applies. Nothing here holds a message on anybody else's behalf,
 * which is the difference between this and the host-authoritative thread it
 * replaces.
 *
 * A frame this screen originated comes back through the relay, and is dropped
 * on `authorStationKey`. Dropping on the VANTAGE would be wrong: a host and a
 * station at one centre share a vantage and must still hear each other.
 */
export class CommcastMesh {
  private readonly unsubs: Array<() => void> = [];

  private constructor(
    private readonly send: (
      frame:
        | { type: "commcast-transmit"; msg: CommsMessage }
        | { type: "commcast-ack"; ack: CommsAck },
    ) => void,
  ) {}

  /**
   * The host end. Every frame from a peer is repeated to the others, because
   * nobody else can reach them, and then offered to this screen's own log.
   */
  static forHost(
    host: PeerHostService,
    me: string,
    handlers: CommcastMeshHandlers,
  ): CommcastMesh {
    const mesh = new CommcastMesh((frame) => host.broadcast(frame));
    mesh.unsubs.push(
      host.onCommcastTransmit((_peerId, frame) => {
        host.broadcast(frame);
        if (frame.msg.authorStationKey === me) return;
        handlers.onMessage(frame.msg);
      }),
      host.onCommcastAck((_peerId, frame) => {
        host.broadcast(frame);
        if (frame.ack.stationKey === me) return;
        handlers.onAck(frame.ack);
      }),
    );
    return mesh;
  }

  /** A peer end. One hop to the host, which does the repeating. */
  static forClient(
    client: PeerClientService,
    me: string,
    handlers: CommcastMeshHandlers,
  ): CommcastMesh {
    const mesh = new CommcastMesh((frame) => {
      if (frame.type === "commcast-transmit")
        client.sendCommcastMessage(frame.msg);
      else client.sendCommcastAck(frame.ack);
    });
    mesh.unsubs.push(
      client.onCommcastTransmit((msg) => {
        if (msg.authorStationKey === me) return;
        handlers.onMessage(msg);
      }),
      client.onCommcastAck((ack) => {
        if (ack.stationKey === me) return;
        handlers.onAck(ack);
      }),
    );
    return mesh;
  }

  transmit(msg: CommsMessage): void {
    this.send({ type: "commcast-transmit", msg });
  }

  acknowledge(ack: CommsAck): void {
    this.send({ type: "commcast-ack", ack });
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
  }
}
