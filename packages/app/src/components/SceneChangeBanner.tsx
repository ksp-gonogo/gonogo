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
 * Initial scene (the first value to arrive) doesn't trigger a banner
 * — that's just the WS warmup, not a transition. Subsequent changes
 * do.
 */

const VISIBLE_MS = 10_000;
const FADE_MS = 400;

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

export function SceneChangeBanner() {
  const sceneRaw = useDataValue("data", "kc.scene");
  const scene = typeof sceneRaw === "string" ? sceneRaw : null;

  // Track previous scene + the one currently being announced. The
  // announcement state outlives the underlying telemetry value because
  // we want to keep showing the banner for VISIBLE_MS regardless of
  // any further changes that arrive during the window.
  const prevSceneRef = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState<{
    from: string | null;
    to: string;
    expiresAt: number;
  } | null>(null);

  useEffect(() => {
    if (scene === null) return;
    const prev = prevSceneRef.current;
    if (prev === null) {
      // First sample — initial scene, not a transition. Set the ref so
      // we'll detect the next change.
      prevSceneRef.current = scene;
      return;
    }
    if (prev === scene) return;
    prevSceneRef.current = scene;
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
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--color-surface-overlay, rgba(20, 22, 26, 0.92));
  border: 1px solid var(--color-accent-fg);
  border-radius: 3px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--color-text-primary);
  z-index: 100;
  pointer-events: none;
  animation: sceneBannerIn ${FADE_MS}ms ease-out forwards;

  @media (prefers-reduced-motion: no-preference) {
    @keyframes sceneBannerIn {
      from {
        opacity: 0;
        transform: translate(-50%, -8px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
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
