import { useDataValue } from "@gonogo/core";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

/**
 * Ephemeral banner at the top of the viewport that surfaces when KSP's
 * scene changes (Space Center → Flight, Flight → Tracking Station,
 * etc). Reads `kc.scene` from the GonogoTelemetry plugin; stays for
 * `VISIBLE_MS` then fades out.
 *
 * Useful because most dashboards run during long flights — when the
 * operator is mid-conversation and KSP transitions (e.g. a launch
 * loaded, a vessel was recovered), an unobtrusive banner gives them a
 * heads-up without taking the dashboard away.
 *
 * Cross-mount continuity: the last-seen scene is persisted to
 * localStorage so a station that reloads or only just connects can
 * still recognise the transition that happened while it was away.
 * Without persistence the station would silently swallow the first
 * value as "initial" and miss the cue (user-reported, 2026-05-12).
 */

const VISIBLE_MS = 10_000;
const FADE_MS = 400;
const STORAGE_KEY = "gonogo.scene-banner.lastSeen";

const SCENE_LABELS: Record<string, string> = {
  Flight: "Flight",
  SpaceCenter: "Space Center",
  Editor: "Editor",
  TrackingStation: "Tracking Station",
  MainMenu: "Main Menu",
  Other: "Loading…",
};

function labelForScene(scene: string): string {
  return SCENE_LABELS[scene] ?? scene;
}

function readStoredScene(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredScene(scene: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, scene);
  } catch {
    /* localStorage unavailable in some test envs / private windows */
  }
}

export function SceneChangeBanner() {
  const sceneRaw = useDataValue("data", "kc.scene");
  const scene = typeof sceneRaw === "string" ? sceneRaw : null;

  // Seed prev-scene from localStorage so a station that reloads (or just
  // joined a host) can compare the first arriving value against the last
  // scene it saw, instead of silently treating every reload as "initial".
  const prevSceneRef = useRef<string | null>(readStoredScene());
  const [announcement, setAnnouncement] = useState<{
    from: string | null;
    to: string;
    expiresAt: number;
  } | null>(null);

  useEffect(() => {
    if (scene === null) return;
    const prev = prevSceneRef.current;
    if (prev === scene) return;
    if (prev === null) {
      // First sample of the lifetime of this device — initial bootstrap,
      // not a transition. Persist + skip the banner so a brand-new tab
      // doesn't pop on every page load.
      prevSceneRef.current = scene;
      writeStoredScene(scene);
      return;
    }
    prevSceneRef.current = scene;
    writeStoredScene(scene);
    setAnnouncement({
      from: prev,
      to: scene,
      expiresAt: Date.now() + VISIBLE_MS,
    });
  }, [scene]);

  // Tear-down timer — re-render once when the announcement should hide.
  useEffect(() => {
    if (announcement === null) return;
    const remaining = announcement.expiresAt - Date.now();
    if (remaining <= 0) {
      setAnnouncement(null);
      return;
    }
    const id = setTimeout(() => setAnnouncement(null), remaining);
    return () => clearTimeout(id);
  }, [announcement]);

  if (announcement === null) return null;

  return (
    <Banner role="status" aria-live="polite">
      {announcement.from && (
        <>
          <BannerScene>{labelForScene(announcement.from)}</BannerScene>
          <Arrow aria-hidden="true">→</Arrow>
        </>
      )}
      <BannerScene $emphasis>{labelForScene(announcement.to)}</BannerScene>
    </Banner>
  );
}

const Banner = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.88);
  border: 1px solid var(--color-accent-fg);
  border-radius: 999px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--color-text-primary);
  pointer-events: none;
  white-space: nowrap;
  animation: sceneBannerIn ${FADE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transform-origin: right center;
  will-change: transform, opacity;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes sceneBannerIn {
    from {
      opacity: 0;
      transform: translateX(40px) scaleX(0.6);
    }
    60% {
      opacity: 1;
    }
    to {
      opacity: 1;
      transform: translateX(0) scaleX(1);
    }
  }
`;

const BannerScene = styled.span<{ $emphasis?: boolean }>`
  font-weight: ${(p) => (p.$emphasis ? 700 : 500)};
  color: ${(p) =>
    p.$emphasis ? "var(--color-accent-fg)" : "var(--color-text-muted)"};
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 11px;
`;

const Arrow = styled.span`
  color: var(--color-text-faint);
  font-size: 12px;
`;
