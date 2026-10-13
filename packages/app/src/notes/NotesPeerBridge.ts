import type { PeerHostService } from "../peer/PeerHostService";
import type { NoteResult } from "./NotesHostService";
import type { NotesSnapshot } from "./types";

export interface NotesPeerBridgeHandlers {
  snapshotFor(centreId: string | null): NotesSnapshot;
  addNote(centreId: string, input: { body: string; createdBy?: string }): void;
  updateNote(
    centreId: string,
    id: string,
    body: string,
    baseVersion: number,
  ): NoteResult;
  deleteNote(centreId: string, id: string, baseVersion: number): NoteResult;
  reorderNote(
    centreId: string,
    id: string,
    afterId: string | null,
    baseVersion: number,
  ): NoteResult;
}

/**
 * Wires station-originated note mutations into the host service, answers each
 * with a `note-result`, and keeps every station holding the list of the
 * command centre it stands at: sent on connect, on every change to that
 * list, and whenever the station or the host moves to another centre. No
 * notes state lives here beyond which centre each station was last sent.
 */
export class NotesPeerBridge {
  private readonly sentCentre = new Map<string, string | null>();

  constructor(
    private readonly host: PeerHostService | null,
    private readonly handlers: NotesPeerBridgeHandlers,
  ) {
    if (!host) return;
    const answer = (peerId: string, ref: string, result: NoteResult) => {
      host.sendToPeer(peerId, {
        type: "note-result",
        ref,
        ok: result.ok,
        current: result.ok ? undefined : result.current,
      });
    };
    // A station with no centre has no list to change.
    const refuseWithoutCentre: NoteResult = { ok: false, current: null };
    host.onNoteAdd((peerId, msg) => {
      const centreId = host.centreOf(peerId);
      if (centreId === null)
        return answer(peerId, msg.ref, refuseWithoutCentre);
      handlers.addNote(centreId, { body: msg.body, createdBy: peerId });
      answer(peerId, msg.ref, { ok: true });
    });
    host.onNoteUpdate((peerId, msg) => {
      const centreId = host.centreOf(peerId);
      answer(
        peerId,
        msg.ref,
        centreId === null
          ? refuseWithoutCentre
          : handlers.updateNote(centreId, msg.id, msg.body, msg.baseVersion),
      );
    });
    host.onNoteDelete((peerId, msg) => {
      const centreId = host.centreOf(peerId);
      answer(
        peerId,
        msg.ref,
        centreId === null
          ? refuseWithoutCentre
          : handlers.deleteNote(centreId, msg.id, msg.baseVersion),
      );
    });
    host.onNoteReorder((peerId, msg) => {
      const centreId = host.centreOf(peerId);
      answer(
        peerId,
        msg.ref,
        centreId === null
          ? refuseWithoutCentre
          : handlers.reorderNote(
              centreId,
              msg.id,
              msg.afterId,
              msg.baseVersion,
            ),
      );
    });
    host.onPeerConnect((peerId) => this.sendCurrent(peerId));
    host.onPeerDisconnect((peerId) => {
      this.sentCentre.delete(peerId);
    });
    host.onCentresChanged(() => {
      for (const peerId of host.connectedPeerIds()) {
        if (this.sentCentre.get(peerId) !== host.centreOf(peerId)) {
          this.sendCurrent(peerId);
        }
      }
    });
  }

  /** Sends `snapshot` to every station standing at its centre. */
  broadcastSnapshot(snapshot: NotesSnapshot): void {
    const host = this.host;
    if (!host) return;
    for (const peerId of host.connectedPeerIds()) {
      if (host.centreOf(peerId) === snapshot.centreId) {
        host.sendToPeer(peerId, { type: "notes-snapshot", snapshot });
      }
    }
  }

  private sendCurrent(peerId: string): void {
    const host = this.host;
    if (!host) return;
    const centreId = host.centreOf(peerId);
    this.sentCentre.set(peerId, centreId);
    host.sendToPeer(peerId, {
      type: "notes-snapshot",
      snapshot: this.handlers.snapshotFor(centreId),
    });
  }
}
