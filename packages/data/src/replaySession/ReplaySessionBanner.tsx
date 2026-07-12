import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { useSyncExternalStore } from "react";
import styled from "styled-components";
import {
  getReplaySessionController,
  type ReplaySessionSnapshot,
} from "./ReplaySessionController";

/**
 * Sticky banner shown across the top of the screen while a mission replay
 * is active. Renders nothing when idle, so callers can mount it
 * unconditionally at the app shell level — the `ReplayBanner` replacement,
 * driven by `ReplaySessionController` instead of the retired
 * `ReplayController`. MUST be mounted as a descendant of
 * `ReplaySessionProvider` (same as the dashboard it controls) — `useViewUt`
 * only reflects the replay session's own clock once that provider has
 * shadowed the live one.
 */
export function ReplaySessionBanner() {
  const controller = getReplaySessionController();
  const snapshot = useSyncExternalStore<ReplaySessionSnapshot>(
    (cb) => controller.subscribe(cb),
    () => controller.getSnapshot(),
  );
  const viewUt = useViewUt();

  if (!snapshot.active || !snapshot.meta) return null;

  const meta = snapshot.meta;
  const position = viewUt ?? meta.firstFrameUt;
  const duration = Math.max(0, meta.lastFrameUt - meta.firstFrameUt);
  const elapsed = Math.max(0, position - meta.firstFrameUt);

  return (
    <Bar role="region" aria-label="Replay controls">
      <Section>
        <PlayButton
          type="button"
          onClick={() =>
            snapshot.playing ? controller.pause() : controller.play()
          }
          aria-label={snapshot.playing ? "Pause replay" : "Play replay"}
        >
          {snapshot.playing ? "❚❚" : "▶"}
        </PlayButton>
        <Title>
          REPLAY: <Strong>{meta.vesselName || "Unnamed vessel"}</Strong>
        </Title>
      </Section>

      <SeekArea>
        <TimeText>{formatElapsed(elapsed)}</TimeText>
        <SeekBar
          type="range"
          min={meta.firstFrameUt}
          max={meta.lastFrameUt}
          step={0.1}
          value={position}
          onChange={(e) => controller.seekTo(Number(e.target.value))}
          aria-label="Seek to position"
        />
        <TimeText>{formatElapsed(duration)}</TimeText>
      </SeekArea>

      <Section>
        <RatePicker
          value={String(snapshot.rate)}
          onChange={(e) => controller.setRate(Number(e.target.value))}
          aria-label="Playback rate"
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="5">5×</option>
          <option value="10">10×</option>
          <option value="50">50×</option>
        </RatePicker>
        <ExitButton
          type="button"
          onClick={() => controller.stop()}
          aria-label="Exit replay and return to live data"
        >
          Exit replay
        </ExitButton>
      </Section>
    </Bar>
  );
}

/** Formats an elapsed UT (seconds) as `h:mm:ss`/`mm:ss` — the seconds-domain twin of the old ms-based `formatElapsed`. */
function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const Bar = styled.div`
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--color-tag-purple-bg, var(--color-surface-raised));
  border-bottom: 2px solid var(--color-tag-purple-fg);
  color: var(--color-text-primary);
  font-size: 12px;
  letter-spacing: 0.04em;
`;

const Section = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const Title = styled.span`
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-muted);
`;

const Strong = styled.span`
  color: var(--color-tag-purple-fg);
  font-weight: 700;
  margin-left: 4px;
`;

const PlayButton = styled.button`
  background: var(--color-tag-purple-fg);
  border: none;
  color: var(--color-surface-app);
  cursor: pointer;
  font-size: 14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const SeekArea = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const SeekBar = styled.input`
  flex: 1;
  min-width: 0;
  accent-color: var(--color-tag-purple-fg);
`;

const TimeText = styled.span`
  font-family: monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
`;

const RatePicker = styled.select`
  background: var(--color-surface-app);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 2px;
`;

const ExitButton = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 2px;
  &:hover { color: var(--color-tag-red-fg); border-color: var(--color-status-alert-muted); }
`;
