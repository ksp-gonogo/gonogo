import { logger } from "@ksp-gonogo/logger";
import {
  UPLINK_BANNER_LIMITS,
  type UplinkBanner,
  type UplinkClientHandle,
} from "@ksp-gonogo/sitrep-sdk";

const log = logger.tag("uplink-banner");

export interface ShownUplinkBanner {
  /** Store key, unique across Uplinks. */
  key: string;
  uplinkId: string;
  uplinkName: string;
  banner: UplinkBanner;
}

interface Entry extends ShownUplinkBanner {
  dismissed: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: readonly ShownUplinkBanner[] = [];

const keyOf = (uplinkId: string, id: string) => `${uplinkId}\u0000${id}`;

function publish(): void {
  snapshot = [...entries.values()].filter((e) => !e.dismissed);
  for (const listener of listeners) listener();
}

function clampText(text: string): string {
  const max = UPLINK_BANNER_LIMITS.maxTextLength;
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function raiseUplinkBanner(
  owner: UplinkClientHandle,
  banner: UplinkBanner,
): void {
  const key = keyOf(owner.id, banner.id);
  const text = clampText(banner.text);
  const existing = entries.get(key);
  if (!existing) {
    const held = [...entries.values()].filter((e) => e.uplinkId === owner.id);
    if (held.length >= UPLINK_BANNER_LIMITS.maxBanners) {
      log.warn(
        `Uplink ${owner.id} already has ${held.length} banners; "${banner.id}" was not shown`,
        { uplinkId: owner.id, bannerId: banner.id },
      );
      return;
    }
  }
  const unchanged =
    existing !== undefined &&
    existing.banner.severity === banner.severity &&
    existing.banner.text === text;
  entries.set(key, {
    key,
    uplinkId: owner.id,
    uplinkName: owner.name,
    banner: { ...banner, text },
    dismissed: unchanged ? existing.dismissed : false,
  });
  publish();
}

export function clearUplinkBanner(owner: UplinkClientHandle, id: string): void {
  if (entries.delete(keyOf(owner.id, id))) publish();
}

export function dismissUplinkBanner(key: string): void {
  const entry = entries.get(key);
  if (!entry || entry.dismissed) return;
  entry.dismissed = true;
  publish();
}

export function subscribeUplinkBanners(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUplinkBanners(): readonly ShownUplinkBanner[] {
  return snapshot;
}

export function resetUplinkBannersForTest(): void {
  entries.clear();
  publish();
}
