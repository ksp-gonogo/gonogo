import type { PeerClientService } from "../peer/PeerClientService";
import type {
  CommcastSnapshot,
  CommsParticipant,
  CommsSendInput,
} from "./types";
import { EMPTY_COMMCAST_SNAPSHOT } from "./types";

type Listener = (snap: CommcastSnapshot) => void;

/**
 * Peer-side mirror of `CommcastHostService`. Receives the canonical thread from
 * the host and exposes the same surface the widget calls at either end.
 *
 * Mutations send peer messages; the next snapshot round-trip is what updates
 * local state, so nothing is applied optimistically. That matters more here
 * than it does for notes: a message the host never received must not sit in
 * the author's own thread looking delivered.
 */
export class CommcastClientService {
  private current: CommcastSnapshot = EMPTY_COMMCAST_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private readonly unsub: () => void;

  constructor(private readonly client: PeerClientService) {
    this.unsub = this.client.onCommcastSnapshot((snap) => {
      this.current = snap;
      for (const cb of this.listeners) cb(snap);
    });
  }

  snapshot(): CommcastSnapshot {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(author: CommsParticipant, input: CommsSendInput): void {
    this.client.sendCommcastMessage(author, input);
  }

  markRead(
    reader: CommsParticipant,
    messageIds: readonly string[],
    atUt: number,
  ): void {
    if (messageIds.length === 0) return;
    this.client.sendCommcastRead(reader, [...messageIds], atUt);
  }

  /** Detach from the peer client. Called when the owning provider unmounts. */
  dispose(): void {
    this.unsub();
    this.listeners.clear();
  }
}
