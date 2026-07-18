import { DEFAULT_PROFILE_ID, type FogMaskStore } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";
import type { PeerHostService } from "../peer/PeerHostService";

interface Deps {
  peerHost: PeerHostService;
  fogStore: FogMaskStore;
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
    try {
      const masks =
        await this.deps.fogStore.loadAllForProfile(DEFAULT_PROFILE_ID);
      if (masks.length === 0) return;
      // Storage key shape is `${profileId}:${bodyId}:${layerId}`. The
      // profile slot is always DEFAULT_PROFILE_ID now, so we slice it off
      // and split on the FIRST `:` to peel off bodyId — body ids (KSP
      // celestial body names) never contain a colon, matching
      // FogMaskStore's own prefix-range assumption elsewhere, but
      // layerId now can (the "<uplinkId>:<name>" convention, e.g.
      // "scansat:AltimetryHiRes"), so splitting on the LAST colon would
      // silently mis-parse bodyId once layerId gained one. The mask
      // record also carries layerId directly, which we forward to the
      // station so it can route to the right per-type slot.
      this.deps.peerHost.sendToPeer(peerId, {
        type: "fog-snapshot",
        masks: masks.map((m) => {
          const afterProfile = m.key.slice(DEFAULT_PROFILE_ID.length + 1);
          const firstColon = afterProfile.indexOf(":");
          const bodyId =
            firstColon >= 0 ? afterProfile.slice(0, firstColon) : afterProfile;
          return {
            bodyId,
            layerId: m.layerId,
            width: m.width,
            height: m.height,
            data: m.data,
          };
        }),
      });
      logger.info(
        `[fog-sync] snapshot sent — peer=${peerId} masks=${masks.length}`,
      );
    } catch (err) {
      logger.error(
        "[fog-sync] failed to send snapshot",
        err instanceof Error ? err : undefined,
      );
    }
  }
}
