import { useTelemetry } from "@ksp-gonogo/core";
import { BannerPill } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";

/** How long the explanation stays up: long enough to read one sentence twice. */
export const HOME_FALLBACK_NOTICE_MS = 12_000;

const STORAGE_KEY = "gonogo.home-fallback-notice.announced";

/** Stands in for `sessionStorage` where the browser refuses it, so the notice still fires once per page load. */
const announcedWithoutStorage = new Set<string>();

function wasAnnounced(centreId: string): boolean {
  try {
    const raw = globalThis.sessionStorage.getItem(STORAGE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) && ids.includes(centreId);
  } catch {
    return announcedWithoutStorage.has(centreId);
  }
}

function markAnnounced(centreId: string): void {
  announcedWithoutStorage.add(centreId);
  try {
    const raw = globalThis.sessionStorage.getItem(STORAGE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(ids) ? [...ids, centreId] : [centreId];
    globalThis.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* sessionStorage unavailable: the in-memory set above still holds it */
  }
}

/**
 * One brief explanation, in the banner stack, when the mod could not identify
 * the home command centre and a ground station is standing in for it. The
 * vantage control shows that station as home like any other, so this is the
 * only place the operator learns it was not identified.
 *
 * Fires when a stand-in first appears, and once per stand-in for the browser
 * tab's session: a re-render, a reconnect or a reload that lands on the same
 * stand-in stays quiet, while a different station taking over is a new
 * situation and is explained again.
 */
export function HomeFallbackNotice() {
  // Ground-side and declared unmodellable, as VantageControl reads it: a stale
  // roster is still the roster.
  const rosterReading = useTelemetry("commandCentre.roster");
  const roster =
    rosterReading.state === "observed" || rosterReading.state === "stale"
      ? rosterReading.value
      : undefined;
  const standIn = (roster ?? []).find(
    (c) => c.active && c.isHome && c.isHomeFallback && c.id != null,
  );
  const standInId = standIn?.id ?? undefined;
  const standInName = standIn?.displayName ?? standInId;

  const [shown, setShown] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (standInId === undefined || standInName === undefined) return;
    if (wasAnnounced(standInId)) return;
    markAnnounced(standInId);
    setShown({ id: standInId, name: standInName });
  }, [standInId, standInName]);

  useEffect(() => {
    if (shown === null) return;
    const id = setTimeout(() => setShown(null), HOME_FALLBACK_NOTICE_MS);
    return () => clearTimeout(id);
  }, [shown]);

  if (shown === null) return null;

  return (
    <BannerPill accent="var(--color-status-info-fg)">
      Unable to identify home station. Using {shown.name}.
    </BannerPill>
  );
}
