import {
  type ArmTriggerInput,
  EMPTY_TRIGGER_SNAPSHOT,
  type ManeuverTriggerService,
  type TriggerSnapshot,
} from "@ksp-gonogo/components";
import type {
  PeerClientService,
  StationApproval,
} from "../peer/PeerClientService";
import { AWAITING_APPROVAL } from "../peer/PeerHostService";

function isApproved(approval: StationApproval): boolean {
  return approval !== "pending" && approval !== "refused";
}

/**
 * Station-side mirror of ManeuverTriggerHostService. Receives the
 * canonical trigger snapshot from the host on every change; routes user
 * arm / cancel intents back to the host as peer messages. The widget
 * can't tell the difference between this and the host service,
 * `ManeuverTriggerService` is the contract.
 */
export class ManeuverTriggerClientService implements ManeuverTriggerService {
  private current: TriggerSnapshot = EMPTY_TRIGGER_SNAPSHOT;
  private listeners = new Set<(snap: TriggerSnapshot) => void>();
  private client: PeerClientService;

  readonly blockedReason = AWAITING_APPROVAL;

  readonly accepting = {
    get: () => isApproved(this.client.getApproval()),
    subscribe: (cb: (accepting: boolean) => void) =>
      this.client.onApprovalChange((approval) => cb(isApproved(approval))),
  };

  constructor(client: PeerClientService) {
    this.client = client;
    this.client.onTriggerSnapshot((snap) => {
      this.current = snap;
      for (const cb of this.listeners) cb(snap);
    });
  }

  snapshot(): TriggerSnapshot {
    return this.current;
  }

  subscribe(cb: (snap: TriggerSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  arm(input: ArmTriggerInput): void {
    this.client.sendTriggerArm(input);
  }

  cancel(id: string): void {
    this.client.sendTriggerCancel(id);
  }
}
