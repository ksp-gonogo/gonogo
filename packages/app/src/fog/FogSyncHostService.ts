import type { FogMaskStore } from "@gonogo/data";
import { logger } from "@gonogo/logger";
import type { PeerHostService } from "../peer/PeerHostService";

interface Deps {
  peerHost: PeerHostService;
  fogStore: FogMaskStore;
  /** Returns the currently-active save profile id at call time. */
  getActiveProfileId: () => string;
}

/**
 * Listens for new station connections and pushes a one-shot fog snapshot
 * to each. Stations apply the masks to their local FogMaskStore so the
 * map starts populated with whatever the host has already explored.
 *
 * No deltas: stations keep computing their own fog from telemetry after
 * the snapshot lands. A station refresh is the way to pick up later
 * host-side discoveries — that's an explicit design call, not an
 * oversight (deltas would mean hooking every host-side mask write,
 * which is out of scope for the current pass).
 */
export class FogSyncHostService {
  private unsub: (() => void) | null = null;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.unsub) return;
    this.unsub = this.deps.peerHost.onPeerConnect((peerId) => {
      void this.sendSnapshot(peerId);
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private async sendSnapshot(peerId: string): Promise<void> {
    const profileId = this.deps.getActiveProfileId();
    try {
      const masks = await this.deps.fogStore.loadAllForProfile(profileId);
      if (masks.length === 0) return;
      this.deps.peerHost.sendToPeer(peerId, {
        type: "fog-snapshot",
        profileId,
        masks: masks.map((m) => ({
          bodyId: m.key.slice(profileId.length + 1),
          width: m.width,
          height: m.height,
          data: m.data,
        })),
      });
      logger.info(
        `[fog-sync] snapshot sent — peer=${peerId} bodies=${masks.length}`,
      );
    } catch (err) {
      logger.error(
        "[fog-sync] failed to send snapshot",
        err instanceof Error ? err : undefined,
      );
    }
  }
}
