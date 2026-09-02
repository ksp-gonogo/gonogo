import type { Seat } from "@ksp-gonogo/sitrep-sdk/spine";
import type { PeerHostService } from "../peer/PeerHostService";
import type {
  CommcastSnapshot,
  CommsParticipant,
  CommsSendInput,
} from "./types";

export interface CommcastPeerBridgeHandlers {
  post(author: CommsParticipant, input: CommsSendInput): void;
  markRead(
    reader: CommsParticipant,
    messageIds: readonly string[],
    atUt: number,
  ): void;
  noteParticipant(participant: CommsParticipant): void;
}

/**
 * Routes peer-originated thread traffic into the host service and exposes
 * `broadcastSnapshot` for the host to call when the thread changes. No thread
 * state lives here: pure event plumbing, in the same style as
 * `NotesPeerBridge` and `AlarmPeerBridge`.
 */
export class CommcastPeerBridge {
  private readonly unsubs: Array<() => void> = [];

  constructor(
    private readonly host: PeerHostService | null,
    handlers: CommcastPeerBridgeHandlers,
  ) {
    if (!host) return;
    this.unsubs.push(
      host.onCommcastSend((_peerId, msg) => {
        handlers.post(msg.author, msg.input);
      }),
      host.onCommcastRead((_peerId, msg) => {
        handlers.markRead(msg.reader, msg.messageIds, msg.atUt);
      }),
      // A peer's display name arrives on its own channel and can land after
      // something it said. Feeding it here is what lets the host patch
      // "Pilot" up to the person's actual name rather than leaving two
      // different absences ("from the ground" and "from nobody") looking the
      // same, which is the notes defect this thread must not inherit.
      host.onStationInfo((_peerId, info) => {
        if (!info.stationKey) return;
        handlers.noteParticipant({
          stationKey: info.stationKey,
          name: info.name,
          seat: info.seat ?? DEFAULT_SEAT,
        });
      }),
    );
  }

  broadcastSnapshot(snapshot: CommcastSnapshot): void {
    this.host?.broadcast({ type: "commcast-snapshot", snapshot });
  }

  dispose(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
  }
}

/**
 * A peer that names no seat is at a command centre. Every client that predates
 * the pilot seat is one by construction, which is why absence means this rather
 * than "unknown".
 */
const DEFAULT_SEAT: Seat = "mission-control";
