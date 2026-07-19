import type {
  SystemUplinkHealth,
  UplinkHealthEntry,
  UplinkHealthStateName,
} from "@ksp-gonogo/sitrep-client";
import { useStream } from "@ksp-gonogo/sitrep-client";

/**
 * Resolution of a widget's declared REQUIRED `channels` against the
 * `system.uplinkHealth` roster — the Phase 2 half of the uplink-health
 * render-gating design (local_docs/uplink-health-render-gating-design.md).
 * `RequiresGuard` (Phase 3) blocks rendering on `"resolved"` with a
 * non-healthy `state`; every other status is a pass-through (there is
 * nothing yet to gate on, or nothing in the declared channels maps to a
 * known owner).
 */
export type UplinkHealthForResult =
  | { status: "no-channels" }
  | { status: "unresolved" }
  | { status: "unowned" }
  | {
      status: "resolved";
      state: UplinkHealthStateName;
      detail: string | null;
      ownerId: string;
    };

const HEALTH_SEVERITY: Record<UplinkHealthStateName, number> = {
  healthy: 0,
  degraded: 1,
  unavailable: 2,
};

/**
 * Longest-prefix match: the entry whose `ownedPrefixes` contains the
 * longest string that `topic` starts with wins. An exact-topic prefix
 * (the common case — see `ChannelEngine.ComputeOwnedPrefixes`'s doc
 * comment) always beats a shorter namespace prefix for the same topic.
 */
function resolveOwner(
  topic: string,
  uplinks: readonly UplinkHealthEntry[],
): UplinkHealthEntry | undefined {
  let best: UplinkHealthEntry | undefined;
  let bestLength = -1;
  for (const entry of uplinks) {
    for (const prefix of entry.ownedPrefixes) {
      if (topic.startsWith(prefix) && prefix.length > bestLength) {
        best = entry;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

function worstOf(entries: readonly UplinkHealthEntry[]): UplinkHealthEntry {
  return entries.reduce((worst, entry) =>
    HEALTH_SEVERITY[entry.health.state] > HEALTH_SEVERITY[worst.health.state]
      ? entry
      : worst,
  );
}

/**
 * Resolves `channels` (a widget's declared REQUIRED topics) to their
 * owning Uplink(s) via longest-prefix match against the
 * `system.uplinkHealth` roster, and reports the WORST health state among
 * every distinct owner found. Never infers ownership itself — it only
 * reads what the mod's `ownedPrefixes` already says (Task 1/2).
 */
export function useUplinkHealthFor(
  channels: readonly string[],
): UplinkHealthForResult {
  const uplinkHealth = useStream<SystemUplinkHealth>("system.uplinkHealth");

  if (channels.length === 0) {
    return { status: "no-channels" };
  }
  if (uplinkHealth === undefined || uplinkHealth === null) {
    return { status: "unresolved" };
  }

  const owners: UplinkHealthEntry[] = [];
  for (const topic of channels) {
    const owner = resolveOwner(topic, uplinkHealth.uplinks);
    if (owner && !owners.some((o) => o.id === owner.id)) {
      owners.push(owner);
    }
  }
  if (owners.length === 0) {
    return { status: "unowned" };
  }

  const worst = worstOf(owners);
  return {
    status: "resolved",
    state: worst.health.state,
    detail: worst.health.detail,
    ownerId: worst.id,
  };
}
